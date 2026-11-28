#!/usr/bin/env python3
"""Tests for checks.py; run with python3 .github/fork-checks/test_checks.py."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import checks

WORKFLOWS = Path(__file__).resolve().parents[1] / 'workflows'


def workflow(*steps, jobs=None, on=None):
    job = {'name': 'Jest', 'runs-on': 'ubuntu-latest', 'timeout-minutes': 10, 'steps': [
        {'name': 'Checkout', 'uses': 'actions/checkout@v4'},
        {'name': 'Setup Node.js', 'uses': 'actions/setup-node@v4', 'with': {'node-version': '24'}},
        {'name': 'Setup pnpm', 'uses': 'pnpm/action-setup@v4'},
        *steps]}
    return {'on': on or {'pull_request': {'branches': ['master']}}, 'jobs': jobs or {'test': job}}


class PlanTests(unittest.TestCase):
    def test_upstream_workflows_plan(self):
        names = {'lint.yml': 'Run ESLint', 'types.yml': 'Check Types', 'testing.yml': 'Run Tests'}
        for name, last in names.items():
            path = WORKFLOWS / name
            if not path.is_file():
                self.skipTest(f'{name} is not in this checkout')
            saved = checks.plan(checks.load(path))
            self.assertEqual(last, saved['steps'][-1]['name'], name)
            self.assertTrue(saved['node'])
            self.assertIn('Install Dependencies', [step['name'] for step in saved['steps']])

    def test_pyyaml_on_key(self):
        data = workflow({'name': 'Run', 'run': 'true'})
        data[True] = data.pop('on')
        self.assertEqual(['Run'], [step['name'] for step in checks.plan(data)['steps']])

    def test_unsupported_shapes_stop_the_check(self):
        run = {'name': 'Run', 'run': 'true'}
        cases = {
            'condition': workflow({**run, 'if': 'always()'}),
            'other action': workflow({'name': 'Upload', 'uses': 'actions/upload-artifact@v4'}, run),
            'expression': workflow({'name': 'Run', 'run': 'echo ${{ github.sha }}'}),
            'shell': workflow({**run, 'shell': 'pwsh'}),
            'two jobs': workflow(run, jobs={'a': {'steps': []}, 'b': {'steps': []}}),
            'no pull request': workflow(run, on={'push': {'branches': ['master']}}),
            'job key': workflow(run, jobs={'a': {'services': {}, 'steps': [run]}}),
            'no node': {'on': {'pull_request': {}}, 'jobs': {'a': {'steps': [run]}}},
        }
        for name, data in cases.items():
            with self.assertRaises(checks.CheckError, msg=name):
                checks.plan(data)


class RunTests(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp())
        self.addCleanup(subprocess.run, ['rm', '-rf', str(self.temp)])

    def run_saved(self, *steps, event=None):
        saved = checks.plan(workflow(*steps))
        return checks.run_steps(saved, self.temp, event, temp=self.temp)

    def test_steps_share_github_env_and_path(self):
        record = self.temp / 'record'
        tools = self.temp / 'tools'
        tools.mkdir()
        (tools / 'probe').write_text('#!/bin/sh\necho probe\n')
        (tools / 'probe').chmod(0o755)
        code = self.run_saved(
            {'name': 'Set', 'shell': 'bash', 'run': f'echo "STORE=/store" >> "$GITHUB_ENV"\n'
                                                   f'printf "TEXT<<EOF\\na\\nb\\nEOF\\n" >> "$GITHUB_ENV"\n'
                                                   f'echo {tools} >> "$GITHUB_PATH"'},
            {'name': 'Read', 'run': f'echo "$STORE|$TEXT|$(probe)|$GITHUB_EVENT_NAME" > {record}'},
            event='pull_request')
        self.assertEqual(0, code)
        self.assertEqual('/store|a\nb|probe|pull_request\n', record.read_text())

    def test_bash_shell_uses_pipefail_and_the_default_does_not(self):
        self.assertEqual(1, self.run_saved({'name': 'Pipe', 'shell': 'bash', 'run': 'false | true'}))
        self.assertEqual(0, self.run_saved({'name': 'Pipe', 'run': 'false | true'}))

    def test_first_failure_stops_the_run(self):
        record = self.temp / 'after'
        code = self.run_saved({'name': 'Fail', 'run': 'exit 3'}, {'name': 'After', 'run': f'touch {record}'})
        self.assertEqual((3, False), (code, record.exists()))


class MergeTests(unittest.TestCase):
    def git(self, repo, *args):
        return subprocess.run(['git', '-C', str(repo), *args], check=True, capture_output=True, text=True,
                              env={**os.environ, **checks.IDENTITY}).stdout.strip()

    def commit(self, repo, name, text):
        (repo / name).write_text(text)
        self.git(repo, 'add', name)
        self.git(repo, 'commit', '-q', '-m', name)
        return self.git(repo, 'rev-parse', 'HEAD')

    def test_merge_puts_upstream_first_and_stops_on_conflict(self):
        root = Path(tempfile.mkdtemp())
        self.addCleanup(subprocess.run, ['rm', '-rf', str(root)])
        upstream, repo = root / 'upstream', root / 'repo'
        self.git(root, 'init', '-q', '-b', 'master', upstream)
        self.commit(upstream, 'a.txt', 'one\n')
        self.git(root, 'clone', '-q', upstream, repo)
        feature = self.commit(repo, 'b.txt', 'feature\n')
        moved = self.commit(upstream, 'c.txt', 'upstream\n')
        base, head = checks.merge(repo, feature, upstream=str(upstream))
        self.assertEqual(moved, base)
        self.assertEqual(f'{moved} {feature}', self.git(repo, 'log', '-1', '--format=%P', head))
        self.git(repo, 'checkout', '-q', feature)
        self.commit(upstream, 'b.txt', 'other\n')
        with self.assertRaises(checks.CheckError):
            checks.merge(repo, feature, upstream=str(upstream))
        with self.assertRaises(checks.CheckError):
            checks.merge(repo, moved, upstream=str(upstream))


if __name__ == '__main__':
    unittest.main()
