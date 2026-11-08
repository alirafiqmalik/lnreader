"""Regression tests using real repositories; no network or user refs are changed."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('stack', Path(__file__).with_name('stack.py'))
stack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stack)

pipeline_spec = importlib.util.spec_from_file_location('pipeline', Path(__file__).with_name('pipeline.py'))
pipeline = importlib.util.module_from_spec(pipeline_spec)
pipeline_spec.loader.exec_module(pipeline)


class CompositionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        stack.git(self.repo, 'init', '-b', 'master')
        stack.git(self.repo, 'config', 'user.name', 'Fixture')
        stack.git(self.repo, 'config', 'user.email', 'fixture@example.invalid')
        self.base = self.commit('book.txt', 'upstream\n')
        self.config = {'schema': 1, 'upstream': 'test/upstream', 'fork': 'test/fork', 'patches': []}
        self.report = self.root / 'report.json'

    def commit(self, file, content):
        (self.repo / file).write_text(content)
        stack.git(self.repo, 'add', '--', file)
        stack.git(self.repo, 'commit', '-m', 'test: change fixture')
        return stack.git(self.repo, 'rev-parse', 'HEAD')

    def feature(self, name, file, content):
        stack.git(self.repo, 'switch', '-c', name, self.base)
        head = self.commit(file, content)
        entry = {'branch': name, 'base': self.base, 'head': head, 'pr': None}
        self.config['patches'].append(entry)
        stack.git(self.repo, 'switch', 'master')
        return entry

    def compose(self, name='output', **kwargs):
        return stack.compose(self.repo, self.config, 'master', self.root / name,
                             self.report, fetch=False, **kwargs)

    def test_multiple_features_survive_upstream_and_reproduce_exact_commit(self):
        first = self.feature('dev/first', 'first.txt', 'first\n')
        second = self.feature('dev/second', 'second.txt', 'second\n')
        upstream = self.commit('new-upstream.txt', 'new\n')
        one = self.compose()
        two = self.compose('again')
        self.assertEqual(one['composed_sha'], two['composed_sha'])
        self.assertEqual(one['upstream'], upstream)
        for file in ('first.txt', 'second.txt', 'new-upstream.txt'):
            self.assertTrue((self.root / 'output' / file).exists())
        self.assertEqual(stack.git(self.repo, 'rev-parse', 'dev/first'), first['head'])
        self.assertEqual(stack.git(self.repo, 'rev-parse', 'dev/second'), second['head'])
        self.assertEqual(stack.git(self.repo, 'rev-parse', 'master'), upstream)

    def test_conflict_preserves_last_good_ref_and_cleans_only_new_checkout(self):
        self.feature('fix/chapter', 'book.txt', 'feature\n')
        stack.git(self.repo, 'branch', 'build/local')
        upstream = self.commit('book.txt', 'changed upstream\n')
        with self.assertRaisesRegex(ValueError, 'fix/chapter.*conflicts'):
            self.compose()
        self.assertEqual(stack.git(self.repo, 'rev-parse', 'build/local'), self.base)
        self.assertEqual(stack.git(self.repo, 'rev-parse', 'master'), upstream)
        self.assertFalse((self.root / 'output').exists())
        self.assertFalse(self.report.exists())

    def test_refuses_existing_destination(self):
        target = self.root / 'output'
        target.mkdir()
        (target / 'user-work').write_text('keep me')
        with self.assertRaisesRegex(ValueError, 'Refusing to replace'):
            self.compose()
        self.assertEqual((target / 'user-work').read_text(), 'keep me')

    def test_missing_remote_branch_fails_instead_of_omitting_patch(self):
        self.feature('fix/missing', 'fix.txt', 'fix\n')
        remote = self.root / 'remote'
        stack.run('git', 'init', '--bare', remote, stdout=stack.subprocess.PIPE)
        stack.git(self.repo, 'remote', 'add', 'origin', str(remote))
        with self.assertRaises(stack.subprocess.CalledProcessError):
            stack.compose(self.repo, self.config, 'master', self.root / 'output', self.report)
        self.assertFalse((self.root / 'output').exists())

    def test_upstreamed_patch_is_recorded_as_redundant(self):
        feature = self.feature('fix/same', 'same.txt', 'same\n')
        self.commit('same.txt', 'same\n')
        result = self.compose()
        self.assertEqual(result['already_present'], [feature['head']])
        self.assertEqual(result['applied'], [])

    def test_immutable_pin_survives_feature_branch_advancement(self):
        entry = self.feature('fix/pinned', 'fix.txt', 'activated\n')
        remote = self.root / 'remote'
        stack.run('git', 'init', '--bare', remote, stdout=stack.subprocess.PIPE)
        stack.git(self.repo, 'remote', 'add', 'origin', str(remote))
        stack.git(self.repo, 'push', 'origin', f"{entry['head']}:refs/tags/patches/{entry['head']}")
        stack.git(self.repo, 'switch', 'fix/pinned')
        self.commit('fix.txt', 'unfinished later work\n')
        stack.git(self.repo, 'push', 'origin', 'fix/pinned')
        stack.git(self.repo, 'switch', 'master')
        result = stack.compose(self.repo, self.config, 'master', self.root / 'output', self.report)
        self.assertEqual((self.root / 'output' / 'fix.txt').read_text(), 'activated\n')
        self.assertEqual(result['applied'], [entry['head']])

    def test_removing_one_feature_keeps_the_other(self):
        self.feature('dev/first', 'first.txt', 'first\n')
        self.feature('dev/second', 'second.txt', 'second\n')
        self.config['patches'].pop(0)
        self.compose()
        self.assertFalse((self.root / 'output' / 'first.txt').exists())
        self.assertTrue((self.root / 'output' / 'second.txt').exists())

    def test_rejects_merge_commits(self):
        entry = self.feature('dev/merge', 'first.txt', 'first\n')
        self.commit('upstream.txt', 'new\n')
        stack.git(self.repo, 'switch', 'dev/merge')
        stack.git(self.repo, 'merge', '--no-ff', 'master', '-m', 'test: merge fixture')
        entry['head'] = stack.git(self.repo, 'rev-parse', 'HEAD')
        with self.assertRaisesRegex(ValueError, 'merge commits are unsupported'):
            self.compose()

    def test_retirement_requires_exact_head_and_merge_in_fetched_base(self):
        entry = self.feature('fix/merged', 'first.txt', 'first\n')
        entry['pr'] = 7
        merged = self.commit('first.txt', 'first\n')
        pr = {'head': {'repo': {'full_name': 'test/fork'}, 'ref': entry['branch'],
                       'sha': entry['head']}, 'merged': True, 'state': 'closed',
              'merge_commit_sha': merged}
        def api(*args, **kwargs):
            return stack.subprocess.CompletedProcess(args, 0, json.dumps(pr))
        original_run = stack.run
        def dispatch(*args, **kwargs):
            return api(*args, **kwargs) if args[0] == 'gh' else original_run(*args, **kwargs)
        with patch.object(stack, 'run', side_effect=dispatch):
            self.assertTrue(stack.merged_upstream(self.repo, self.config, entry, merged))
            self.assertFalse(stack.merged_upstream(self.repo, self.config, entry, self.base))
            pr['head']['sha'] = self.base
            self.assertFalse(stack.merged_upstream(self.repo, self.config, entry, merged))
            pr['merged'] = False
            self.assertFalse(stack.merged_upstream(self.repo, self.config, entry, merged))


class PackagingTests(unittest.TestCase):
    def test_packages_both_required_abis_and_preserves_source_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'apk'
            source.mkdir()
            report = root / 'build-manifest.json'
            report.write_text(json.dumps({'version_code': 100000001, 'tag': 'personal-100000001'}))
            elements = []
            for abi in ('arm64-v8a', 'x86_64'):
                name = f'app-{abi}-release-unsigned.apk'
                (source / name).write_bytes(b'apk fixture')
                elements.append({'filters': [{'filterType': 'ABI', 'value': abi}],
                                 'versionCode': 100000001, 'outputFile': name})
            (source / 'output-metadata.json').write_text(json.dumps({'elements': elements}))
            pipeline.package(source, root / 'output', report)
            self.assertEqual(len(list((root / 'output').glob('*.apk'))), 2)
            self.assertEqual((root / 'output' / 'build-manifest.json').read_text(), report.read_text())
            elements[1]['versionCode'] += 1
            (source / 'output-metadata.json').write_text(json.dumps({'elements': elements}))
            with self.assertRaisesRegex(ValueError, 'incorrect versionCode for x86_64'):
                pipeline.package(source, root / 'bad', report)
            elements.pop()
            (source / 'output-metadata.json').write_text(json.dumps({'elements': elements}))
            with self.assertRaisesRegex(ValueError, 'Missing APK'):
                pipeline.package(source, root / 'missing', report)


if __name__ == '__main__':
    unittest.main()
