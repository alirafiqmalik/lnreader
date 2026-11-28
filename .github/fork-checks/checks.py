#!/usr/bin/env python3
"""Run upstream LNReader CI jobs on a fork commit, merged onto upstream master as a pull request is.

    checks.py merge --repo DIR --sha SHA [--no-merge]   merge SHA into upstream master in DIR
    checks.py plan WORKFLOW --output FILE                check the upstream job and save its run steps
    checks.py run FILE --cwd DIR [--event NAME]          run the saved steps the way GitHub runs them

The fork-checks workflow gives the setup actions (checkout, pnpm, Node, cache). `plan` refuses a job
that needs anything else, so a change in upstream CI stops the check instead of being skipped.
Standard library only; YAML goes through yq, or PyYAML when yq is missing.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

UPSTREAM = 'https://github.com/lnreader/lnreader.git'
SETUP_ACTIONS = ('actions/checkout@', 'actions/setup-node@', 'pnpm/action-setup@', 'actions/cache@')
JOB_KEYS = {'name', 'runs-on', 'timeout-minutes', 'steps'}
USES_KEYS = {'name', 'uses', 'with', 'id'}
RUN_KEYS = {'name', 'run', 'shell', 'env', 'working-directory'}
# GitHub's shells: the default is `bash -e {0}`; `shell: bash` adds no profile and pipefail.
SHELLS = {None: ['bash', '-e'], 'bash': ['bash', '--noprofile', '--norc', '-eo', 'pipefail'], 'sh': ['sh', '-e']}
IDENTITY = {'GIT_AUTHOR_NAME': 'Fork checks', 'GIT_AUTHOR_EMAIL': 'fork-checks@users.noreply.github.com',
            'GIT_COMMITTER_NAME': 'Fork checks', 'GIT_COMMITTER_EMAIL': 'fork-checks@users.noreply.github.com'}


class CheckError(Exception):
    """A problem that stops the check, with a message for the job log."""


def load(path):
    if shutil.which('yq'):
        text = subprocess.run(['yq', '-o=json', '.', str(path)], check=True, capture_output=True, text=True).stdout
        return json.loads(text)
    import yaml

    return yaml.safe_load(Path(path).read_text())


def plan(data):
    """Return {job, node, steps} for the one job of an upstream workflow, or raise CheckError."""
    # PyYAML reads the key `on` as True.
    triggers = data.get('on', data.get(True))
    if not isinstance(triggers, dict) or 'pull_request' not in triggers:
        raise CheckError('The upstream workflow does not run on pull requests any more.')
    jobs = data.get('jobs') or {}
    if len(jobs) != 1:
        raise CheckError(f'The upstream workflow has {len(jobs)} jobs; fork checks support one.')
    (job_id, job), = jobs.items()
    extra = sorted(set(job) - JOB_KEYS)
    if extra:
        raise CheckError(f'The upstream job uses {", ".join(extra)}, which fork checks do not support.')
    node, steps = None, []
    for index, step in enumerate(job.get('steps') or []):
        label = step.get('name') or f'step {index + 1}'
        if 'if' in step:
            raise CheckError(f'{label}: fork checks do not support a step condition.')
        if 'uses' in step:
            if set(step) - USES_KEYS or not str(step['uses']).startswith(SETUP_ACTIONS):
                raise CheckError(f'{label}: fork checks do not provide {step["uses"]}.')
            if str(step['uses']).startswith('actions/setup-node@'):
                node = str((step.get('with') or {}).get('node-version') or '')
            continue
        if 'run' not in step or set(step) - RUN_KEYS:
            raise CheckError(f'{label}: fork checks support only name, run, shell, env and working-directory.')
        if step.get('shell') not in SHELLS:
            raise CheckError(f'{label}: fork checks do not support the shell {step["shell"]}.')
        env = {str(key): str(value) for key, value in (step.get('env') or {}).items()}
        if '${{' in json.dumps([step['run'], env, step.get('working-directory')]):
            raise CheckError(f'{label}: fork checks do not support expressions in run steps.')
        steps.append({'name': label, 'run': step['run'], 'shell': step.get('shell'), 'env': env,
                      'working-directory': step.get('working-directory')})
    if not node or '${{' in node:
        raise CheckError('The upstream setup-node step has no fixed node-version.')
    if not steps:
        raise CheckError('The upstream job has no run steps.')
    return {'job': job.get('name') or job_id, 'node': node, 'steps': steps}


def parse_env(text):
    """Read a GITHUB_ENV file: NAME=value lines and NAME<<DELIMITER blocks."""
    values, lines = {}, text.splitlines()
    while lines:
        line = lines.pop(0)
        if '<<' in line and ('=' not in line or line.index('<<') < line.index('=')):
            name, delimiter = line.split('<<', 1)
            block = []
            while lines and lines[0] != delimiter:
                block.append(lines.pop(0))
            if lines:
                lines.pop(0)
            values[name] = '\n'.join(block)
        elif '=' in line:
            name, value = line.split('=', 1)
            values[name] = value
    return values


def run_steps(saved, cwd, event=None, temp=None):
    """Run the saved steps in order; return the exit code of the first failed step, or 0."""
    env = dict(os.environ)
    if event:
        env['GITHUB_EVENT_NAME'] = event
    temp = Path(temp or os.environ.get('RUNNER_TEMP') or tempfile.mkdtemp())
    for index, step in enumerate(saved['steps']):
        script = temp / f'fork-checks-{index}.sh'
        script.write_text(step['run'])
        env_file, path_file = temp / f'fork-checks-{index}.env', temp / f'fork-checks-{index}.path'
        env_file.write_text('')
        path_file.write_text('')
        child = {**env, **step['env'], 'GITHUB_ENV': str(env_file), 'GITHUB_PATH': str(path_file)}
        print(f'::group::{step["name"]}', flush=True)
        code = subprocess.run([*SHELLS[step['shell']], str(script)], env=child,
                              cwd=Path(cwd) / (step['working-directory'] or '.')).returncode
        print('::endgroup::', flush=True)
        if code:
            print(f'::error::{step["name"]} failed (exit {code}).', flush=True)
            return code
        env.update(parse_env(env_file.read_text()))
        for directory in path_file.read_text().splitlines():
            if directory.strip():
                env['PATH'] = directory.strip() + os.pathsep + env['PATH']
    return 0


def git(repo, *args, env=None):
    return subprocess.run(['git', '-C', str(repo), *args], check=True, capture_output=True, text=True,
                          env=env).stdout.strip()


def merge(repo, sha, *, upstream=UPSTREAM, enabled=True):
    """Check out SHA merged onto upstream master; return (upstream, merge commit)."""
    if git(repo, 'rev-parse', 'HEAD') != sha:
        raise CheckError('The checkout is not the requested commit.')
    if not enabled:
        return None, sha
    git(repo, 'fetch', '--quiet', '--no-tags', upstream, 'master')
    base = git(repo, 'rev-parse', 'FETCH_HEAD')
    git(repo, 'checkout', '--quiet', '--detach', base)
    date = git(repo, 'log', '-1', '--format=%cI', sha)
    env = {**os.environ, **IDENTITY, 'GIT_AUTHOR_DATE': date, 'GIT_COMMITTER_DATE': date}
    result = subprocess.run(['git', '-C', str(repo), '-c', 'core.hooksPath=/dev/null', 'merge', '--no-ff',
                             '--quiet', '-m', f'Merge {sha} into upstream master', sha], env=env,
                            capture_output=True, text=True)
    if result.returncode:
        raise CheckError('The commit conflicts with upstream master. Rebase it, then check again.')
    return base, git(repo, 'rev-parse', 'HEAD')


def summary(text):
    path = os.environ.get('GITHUB_STEP_SUMMARY')
    if path:
        with open(path, 'a') as stream:
            stream.write(text + '\n')
    print(text, flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest='command', required=True)
    merging = commands.add_parser('merge')
    merging.add_argument('--repo', required=True)
    merging.add_argument('--sha', required=True)
    merging.add_argument('--no-merge', action='store_true')
    planning = commands.add_parser('plan')
    planning.add_argument('workflow')
    planning.add_argument('--output', required=True)
    running = commands.add_parser('run')
    running.add_argument('saved')
    running.add_argument('--cwd', required=True)
    running.add_argument('--event')
    args = parser.parse_args(argv)
    try:
        if args.command == 'merge':
            base, head = merge(args.repo, args.sha, enabled=not args.no_merge)
            summary(f'Commit `{args.sha}`' + (f' merged onto upstream master `{base}` as `{head}`.' if base
                                               else ' without a merge.'))
        elif args.command == 'plan':
            saved = plan(load(args.workflow))
            Path(args.output).write_text(json.dumps(saved, indent=2) + '\n')
            output = os.environ.get('GITHUB_OUTPUT')
            if output:
                with open(output, 'a') as stream:
                    stream.write(f'node={saved["node"]}\n')
            print(f'{saved["job"]}: Node {saved["node"]}, steps: {", ".join(s["name"] for s in saved["steps"])}')
        else:
            return run_steps(json.loads(Path(args.saved).read_text()), args.cwd, args.event)
    except (CheckError, subprocess.CalledProcessError) as error:
        print(f'::error::{error}', flush=True)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
