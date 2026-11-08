# LNReader Personal builds

This fork publishes standalone APKs containing upstream LNReader plus selected
feature branches. Download ARM64 for a tablet or x86_64 for an emulator from
[Releases](https://github.com/alirafiqmalik/lnreader/releases).

- `master` mirrors upstream exactly. Clone with `--branch master` for development.
- `fork-ci` is the default automation branch. The ordered, pinned feature list is
  [`.github/fork/stack.json`](.github/fork/stack.json).
- `build/local` is generated source for the latest successfully published build.
  Develop features on separate branches, never on this generated branch.
- [Build Personal APK](https://github.com/alirafiqmalik/lnreader/actions/workflows/fork-build.yml)
  runs daily, when the stack changes, or manually. Unchanged scheduled runs skip
  compilation. Conflicts preserve the last published APK.

In the local development workspace, use `bin/lndev worktree NAME`, commit the
feature, then `bin/lndev fork activate dev/NAME`. Use `fork compose` to reproduce
the selected source locally, `fork status` to inspect it, and `fork retire BRANCH`
to remove a feature. Upstream PRs are optional; attach one with `activate ... --pr NUMBER`.
The personal Android configuration patch is required and stays enabled.

LNReader Personal installs alongside upstream and updates through this fork's
release channel. Each release includes checksums and a manifest of its source
revisions. Keep the signing key and password backed up outside Git.

---

<p align="center">
  <a href="https://lnreader.app">
    <img src="./.github/readme-images/icon_new.png" align="center" width="128" />
  </a>
</p>

<h1 align="center">LNReader</h1>

<p align="center">
  LNReader is a free and open source light novel reader for Android, inspired by Tachiyomi.
</p>

<div align="center">
  <a href="https://discord.gg/QdcWN4MD63">
    <img alt="Discord Chat" src="https://img.shields.io/discord/835746409357246465.svg?logo=discord&logoColor=white&logoWidth=20&labelColor=5865F2&color=4752C4&label=discord&style=flat">
  </a>
  <a href="https://github.com/lnreader/lnreader/releases">
    <img alt="GitHub Downloads" src="https://img.shields.io/github/downloads/lnreader/lnreader/total?label=downloads&labelColor=27303D&color=0D1117&logo=github&logoColor=FFFFFF&style=flat">
  </a>
</div>

<div align="center">
  <img alt="GitHub Actions Workflow Status" src="https://img.shields.io/github/actions/workflow/status/lnreader/lnreader/build.yml?labelColor=27303D&style=flat">
  <a href="https://github.com/lnreader/lnreader/blob/main/LICENSE">
    <img alt="GitHub" src="https://img.shields.io/github/license/lnreader/lnreader?labelColor=27303D&color=1a73e8&style=flat">
  </a>
  <a title="Crowdin" target="_blank" href="https://crowdin.com/project/lnreader">
    <img src="https://badges.crowdin.net/lnreader/localized.svg">
  </a>
</div>

<h2 align="center">Download</h2>

<p align="center">
  <a href="https://github.com/lnreader/lnreader/releases/latest">
    <img alt="GitHub release (latest by date)" src="https://img.shields.io/github/v/release/lnreader/lnreader?label=Stable&labelColor=0d7377&color=084c4e&style=flat">
  </a>
  <a href="https://github.com/lnreader/lnreader/actions/workflows/build.yml">
    <img alt="Build Preview" src="https://github.com/lnreader/lnreader/actions/workflows/build.yml/badge.svg">
  </a>
</p>

<p align="center">
  Get the app from our <a href="https://github.com/lnreader/lnreader/releases">releases page</a>.
</p>

<p align="center">
  <em>Android 7.0 or higher.</em>
</p>

<h2 align="center">Screenshots</h2>

<p align="center">
  <img src="./.github/readme-images/screenshots.png" align="center" />
</p>

## Plugins

LNReader does not have any affiliation with the content providers available.

Plugin requests should be created at [lnreader-plugins](https://github.com/lnreader/lnreader-plugins).

## Translation

Help translate LNReader into your language on [Crowdin](https://crowdin.com/project/lnreader).

## Building & Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md)

## License

[MIT](https://github.com/lnreader/lnreader/blob/main/LICENSE)
