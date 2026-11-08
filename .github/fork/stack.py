#!/usr/bin/env python3
"""Compose pinned, linear feature branches without rewriting their source refs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

CONTROL = 'fork-ci'
MANIFEST = '.github/fork/stack.json'
BRANCH = re.compile(r'(dev|feat|fix|perf|refactor|chore)/[a-z0-9][a-z0-9._/-]*$')
SHA = re.compile(r'[0-9a-f]{40}$')
IDENTITY = {'GIT_COMMITTER_NAME': 'LNReader Fork',
            'GIT_COMMITTER_EMAIL': '41898282+github-actions[bot]@users.noreply.github.com'}


def run(*args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, text=True, **kwargs)


def git(repo, *args, **kwargs):
    return run('git', '-C', repo, *args, stdout=subprocess.PIPE, **kwargs).stdout.strip()


def ancestor(repo, older, newer):
    return subprocess.run(['git', '-C', str(repo), 'merge-base', '--is-ancestor', older, newer],
                          check=False).returncode == 0


def load(path):
    config = json.loads(Path(path).read_text())
    if config.get('schema') != 1:
        raise ValueError('Unsupported stack schema')
    for key in ('fork', 'upstream'):
        if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', config[key]):
            raise ValueError(f'Invalid repository: {key}')
    names = set()
    for patch in config['patches']:
        name = patch['branch']
        if not BRANCH.fullmatch(name) or '..' in name or name in names:
            raise ValueError(f'Invalid or duplicate patch branch: {name}')
        names.add(name)
        for key in ('base', 'head'):
            if not SHA.fullmatch(patch[key]):
                raise ValueError(f'{name}: {key} must be a full commit SHA')
        if patch.get('pr') is not None and (type(patch['pr']) is not int or patch['pr'] < 1):
            raise ValueError(f'{name}: PR must be a positive integer')
    if config.get('required_patch') and config['required_patch'] not in names:
        raise ValueError('The required personal Android configuration patch is missing')
    return config


def commits(repo, patch):
    base, head = patch['base'], patch['head']
    if not ancestor(repo, base, head):
        raise ValueError(f"{patch['branch']}: base is not an ancestor of head")
    if git(repo, 'rev-list', '--merges', f'{base}..{head}'):
        raise ValueError(f"{patch['branch']}: use a linear feature branch; merge commits are unsupported")
    return git(repo, 'rev-list', '--reverse', f'{base}..{head}').splitlines()


def merged_upstream(repo, config, patch, upstream):
    """Retire only the exact PR revision after its merge is in our fetched base."""
    if not patch.get('pr'):
        return False
    pr = json.loads(run('gh', 'api', f"repos/{config['upstream']}/pulls/{patch['pr']}",
                        stdout=subprocess.PIPE).stdout)
    if pr['head']['repo'] is None or pr['head']['repo']['full_name'] != config['fork']:
        raise ValueError(f"{patch['branch']}: PR belongs to a different fork")
    if pr['head']['ref'] != patch['branch']:
        raise ValueError(f"{patch['branch']}: PR belongs to a different branch")
    merged = pr.get('merge_commit_sha')
    if pr.get('merged') and pr['head']['sha'] == patch['head'] and merged:
        return ancestor(repo, merged, upstream)
    if pr['state'] == 'closed' and not pr.get('merged'):
        print(f"WARNING: {patch['branch']}: PR closed without merge; keeping the patch")
    return False


def compose(repo, config, base, destination, report, *, fetch=True, check_prs=False):
    destination = Path(destination).resolve()
    if destination.exists():
        raise ValueError(f'Refusing to replace existing checkout: {destination}')
    upstream = git(repo, 'rev-parse', '--verify', f'{base}^{{commit}}')
    active, retired = [], []
    for patch in config['patches']:
        # Even a missing active branch is a failure, never a silently omitted feature.
        if fetch:
            git(repo, 'fetch', '--no-tags', 'origin', f"refs/heads/{patch['branch']}")
            git(repo, 'fetch', '--no-tags', 'origin', patch['head'])
        if not ancestor(repo, patch['base'], upstream):
            raise ValueError(f"{patch['branch']}: base is not in upstream master")
        revisions = commits(repo, patch)
        if check_prs and merged_upstream(repo, config, patch, upstream):
            retired.append(patch)
        else:
            active.append((patch, revisions))
    source = {'upstream': upstream, 'patches': [p for p, _ in active]}
    fingerprint = hashlib.sha256(json.dumps(source, sort_keys=True).encode()).hexdigest()
    git(repo, 'worktree', 'add', '--detach', destination, upstream)
    applied, redundant = [], []
    try:
        for patch, revisions in active:
            for revision in revisions:
                before = git(destination, 'rev-parse', 'HEAD')
                # Stable committer identity/date makes identical inputs reproduce the same SHA.
                env = {**os.environ, **IDENTITY,
                       'GIT_COMMITTER_DATE': git(repo, 'show', '-s', '--format=%cI', revision)}
                try:
                    git(destination, '-c', 'core.hooksPath=/dev/null', 'cherry-pick',
                        '-x', '--empty=drop', revision, env=env)
                except subprocess.CalledProcessError as error:
                    conflicts = git(destination, 'diff', '--name-only', '--diff-filter=U')
                    git(destination, 'cherry-pick', '--abort')
                    raise ValueError(f"{patch['branch']} at {revision} conflicts:\n{conflicts}") from error
                after = git(destination, 'rev-parse', 'HEAD')
                (redundant if before == after else applied).append(revision)
        result = {**source, 'schema': 1, 'fingerprint': fingerprint,
                  'composed_sha': git(destination, 'rev-parse', 'HEAD'),
                  'retired': retired, 'applied': applied, 'already_present': redundant}
        Path(report).parent.mkdir(parents=True, exist_ok=True)
        Path(report).write_text(json.dumps(result, indent=2) + '\n')
        return result
    except Exception:
        # Only this function's new disposable checkout is removed on failure.
        git(repo, 'worktree', 'remove', '--force', destination)
        raise


def update_config(repo, change, message):
    git(repo, 'fetch', 'origin', CONTROL)
    with tempfile.TemporaryDirectory(prefix='lnreader-config-') as temporary:
        tree = Path(temporary) / 'control'
        git(repo, 'worktree', 'add', '--detach', tree, f'origin/{CONTROL}')
        try:
            path = tree / MANIFEST
            config = load(path)
            change(config)
            path.write_text(json.dumps(config, indent=2) + '\n')
            load(path)
            if not git(tree, 'diff', '--', MANIFEST):
                return False
            # Only this validated manifest (repository names, branch names and SHAs) is staged.
            git(tree, 'add', '--', MANIFEST)
            env = {**os.environ, **IDENTITY,
                   'GIT_AUTHOR_NAME': IDENTITY['GIT_COMMITTER_NAME'],
                   'GIT_AUTHOR_EMAIL': IDENTITY['GIT_COMMITTER_EMAIL']}
            git(tree, '-c', 'core.hooksPath=/dev/null', 'commit', '-m', message, env=env)
            # A concurrent config edit causes a normal non-fast-forward rejection.
            git(tree, '-c', 'core.hooksPath=/dev/null', 'push', 'origin', f'HEAD:{CONTROL}')
            return True
        finally:
            git(repo, 'worktree', 'remove', '--force', tree)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--config', type=Path, default=Path(__file__).with_name('stack.json'))
    commands = parser.add_subparsers(dest='command', required=True)
    c = commands.add_parser('compose')
    c.add_argument('--base', default='origin/master')
    c.add_argument('--output', required=True)
    c.add_argument('--report', required=True)
    c.add_argument('--check-prs', action='store_true')
    commands.add_parser('sync')
    a = commands.add_parser('activate')
    a.add_argument('branch')
    a.add_argument('--pr', type=int)
    a.add_argument('--base')
    r = commands.add_parser('retire')
    r.add_argument('branch')
    r = commands.add_parser('retire-merged')
    r.add_argument('--report', required=True)
    commands.add_parser('status')
    commands.add_parser('publish')
    args = parser.parse_args()
    repo, config = args.repo.resolve(), load(args.config)
    if args.command == 'compose':
        print(json.dumps(compose(repo, config, args.base, args.output, args.report,
                                 check_prs=args.check_prs), indent=2))
    elif args.command == 'sync':
        git(repo, 'fetch', '--no-tags', f"https://github.com/{config['upstream']}.git", 'refs/heads/master')
        upstream = git(repo, 'rev-parse', 'FETCH_HEAD')
        git(repo, 'fetch', 'origin', 'master')
        if not ancestor(repo, 'origin/master', upstream):
            raise ValueError('Fork master has diverged; refusing to reset or force-push it')
        git(repo, 'push', 'origin', f'{upstream}:refs/heads/master')
        print(upstream)
    elif args.command == 'activate':
        if not BRANCH.fullmatch(args.branch) or '..' in args.branch:
            raise ValueError('Use a dev/, feat/, fix/, perf/, refactor/ or chore/ branch')
        for record in git(repo, 'worktree', 'list', '--porcelain').split('\n\n'):
            lines = record.splitlines()
            if f'branch refs/heads/{args.branch}' in lines:
                tree = lines[0].removeprefix('worktree ')
                if git(tree, 'status', '--porcelain'):
                    raise ValueError(f'Commit or stash unfinished changes in {tree} before activation')
        git(repo, 'fetch', 'upstream', 'master')
        head = git(repo, 'rev-parse', '--verify', f'refs/heads/{args.branch}')
        base = git(repo, 'rev-parse', '--verify', args.base) if args.base else git(repo, 'merge-base', head, 'upstream/master')
        patch = {'branch': args.branch, 'base': base, 'head': head, 'pr': args.pr}
        if not ancestor(repo, base, 'upstream/master') or not commits(repo, patch):
            raise ValueError('Feature needs commits above a base contained in upstream/master')
        git(repo, 'push', '-u', 'origin', f'{args.branch}:refs/heads/{args.branch}')
        def activate(current):
            for index, old in enumerate(current['patches']):
                if old['branch'] == args.branch:
                    if args.pr is None:
                        patch['pr'] = old.get('pr')
                    current['patches'][index] = patch
                    return
            current['patches'].append(patch)
        changed = update_config(repo, activate, f'chore(fork): activate {args.branch}')
        if not changed:
            run('gh', 'workflow', 'run', 'fork-build.yml', '--repo', config['fork'], '--ref', CONTROL)
    elif args.command == 'retire':
        def retire(current):
            if args.branch == current.get('required_patch'):
                raise ValueError('The personal Android configuration is required for APK publishing')
            if not any(p['branch'] == args.branch for p in current['patches']):
                raise ValueError(f'{args.branch} is not active')
            current['patches'] = [p for p in current['patches'] if p['branch'] != args.branch]
        update_config(repo, retire, f'chore(fork): retire {args.branch}')
    elif args.command == 'retire-merged':
        retired = json.loads(Path(args.report).read_text())['retired']
        if retired:
            def retire_merged(current):
                current['patches'] = [p for p in current['patches'] if p not in retired]
            update_config(repo, retire_merged, 'chore(fork): retire integrated patches [skip ci]')
    elif args.command == 'publish':
        run('gh', 'workflow', 'run', 'fork-build.yml', '--repo', config['fork'], '--ref', CONTROL)
    else:
        print(json.dumps(config, indent=2))
        run('gh', 'run', 'list', '--repo', config['fork'], '--workflow', 'fork-build.yml', '--limit', '3')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
