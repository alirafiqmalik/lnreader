#!/usr/bin/env python3
"""Release bookkeeping. Invoked only from the trusted fork-ci checkout."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


def output(*args):
    return subprocess.check_output([str(a) for a in args], text=True).strip()


def prepare(report, repo, force):
    data = json.loads(report.read_text())
    data['controller_sha'] = output('git', '-C', repo, 'rev-parse', 'HEAD')
    controller_files = output('git', '-C', repo, 'ls-tree', '-r', 'HEAD', '--',
                              '.github/fork/stack.py', '.github/fork/pipeline.py',
                              '.github/workflows/fork-build.yml')
    data['build_fingerprint'] = hashlib.sha256(
        (data['fingerprint'] + controller_files).encode()).hexdigest()
    previous_ref = output('git', '-C', repo, 'ls-remote', 'origin', 'refs/heads/build/local')
    data['previous_build_sha'] = previous_ref.split()[0] if previous_ref else ''
    repository = os.environ['GITHUB_REPOSITORY']
    releases = json.loads(output('gh', 'api', '--paginate', '--slurp', f'repos/{repository}/releases?per_page=100'))
    published = [release for page in releases for release in page
                 if not release['draft'] and re.fullmatch(r'personal-\d+', release['tag_name'])]
    latest = max(published, key=lambda r: int(r['tag_name'].split('-')[1]), default=None)
    previous = 0
    should_build = True
    if latest:
        previous = int(latest['tag_name'].split('-')[1])
        with tempfile.TemporaryDirectory() as temporary:
            subprocess.run(['gh', 'release', 'download', latest['tag_name'], '--repo', repository,
                            '--pattern', 'build-manifest.json', '--dir', temporary], check=True)
            old = json.loads((Path(temporary) / 'build-manifest.json').read_text())
            should_build = force or old.get('build_fingerprint') != data['build_fingerprint']
    data['version_code'] = max(100000000 + int(os.environ['GITHUB_RUN_NUMBER']), previous + 1)
    data['tag'] = f"personal-{data['version_code']}"
    data['run_url'] = f"https://github.com/{repository}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
    report.write_text(json.dumps(data, indent=2) + '\n')
    with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
        stream.write(f"should_build={str(should_build).lower()}\n")
        for key in ('composed_sha', 'version_code', 'tag'):
            stream.write(f'{key}={data[key]}\n')
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
        stream.write(f"Upstream: `{data['upstream']}`\n\nComposed: `{data['composed_sha']}`\n\n")
        for entry in data['patches']:
            stream.write(f"- `{entry['branch']}` @ `{entry['head']}`\n")
        for entry in data['retired']:
            stream.write(f"- Integrated upstream: `{entry['branch']}` (PR #{entry['pr']})\n")
        if not should_build:
            stream.write('\nSource and pipeline unchanged; keeping the existing APK.\n')


def package(source, destination, report):
    data = json.loads(report.read_text())
    destination.mkdir(parents=True, exist_ok=True)
    metadata = json.loads((source / 'output-metadata.json').read_text())
    for abi in ('arm64-v8a', 'x86_64'):
        matches = [e for e in metadata['elements'] if {'filterType': 'ABI', 'value': abi} in e['filters']]
        if len(matches) != 1 or matches[0]['versionCode'] != data['version_code']:
            raise ValueError(f'Missing APK or incorrect versionCode for {abi}')
        filename = matches[0]['outputFile']
        if Path(filename).name != filename:
            raise ValueError('Invalid APK output filename')
        shutil.copyfile(source / filename, destination / f"LNReader-{data['tag']}-{abi}.apk")
    shutil.copyfile(report, destination / 'build-manifest.json')


def notes(report, destination):
    data = json.loads(report.read_text())
    lines = ['LNReader Personal', '',
             'Install ARM64 on your tablet, or x86_64 on the development emulator.',
             'This app installs alongside upstream LNReader. Later personal APKs update this installation.',
             '', f"Upstream: `{data['upstream']}`", f"Source: `{data['composed_sha']}`",
             f"Version code: `{data['version_code']}`", '', 'Included changes:', '']
    lines += [f"- `{p['branch']}` at `{p['head']}`" for p in data['patches']]
    lines += ['', f"Build: {data['run_url']}", '',
              'Checksums, source revisions, and signing certificate fingerprint are attached.', '']
    destination.write_text('\n'.join(lines))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'package', 'notes'])
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--repo', type=Path)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--destination', type=Path)
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    if args.command == 'prepare':
        prepare(args.report, args.repo, args.force)
    elif args.command == 'package':
        package(args.source, args.destination, args.report)
    else:
        notes(args.report, args.destination)


if __name__ == '__main__':
    main()
