# AGENTS.md

LNReader is a React Native (Expo SDK 55, RN 0.83) light‑novel reader app for Android/iOS. It is a single client‑side product (no backend); on‑device data lives in SQLite via `@op-engineering/op-sqlite` + Drizzle ORM. Package manager is `pnpm`. See `README.md`, `CONTRIBUTING.md`, and `TESTING.md` for the canonical docs.

## Cursor Cloud specific instructions

The startup update script already runs `pnpm install --frozen-lockfile` and `pnpm run generate:env:debug`, so dependencies and the generated env are in place when a session starts. Notes that are not obvious from the existing docs:

- **`@env` is generated, not committed.** `src/generated/build-info.ts` (aliased as `@env`) and `.env` are git‑ignored and produced by `scripts/generate-env-file.cjs`. Without them, `pnpm run type-check` and Metro bundling fail with `Cannot find module '@env'`. The update script regenerates them via `pnpm run generate:env:debug`; re-run that script if the files go missing.
- **DB tests need a writable `/files/SQLite` directory.** `src/database/db.ts` opens SQLite at the relative path `../files/SQLite`, which resolves to `/files/SQLite` because the repo lives at `/workspace` (one level under `/`). In CI the repo is nested deeper, so this works automatically there. This VM has `/files/SQLite` pre‑created and owned by the `ubuntu` user (persisted in the snapshot). If `pnpm test`/`pnpm run test:db` fails with `EACCES ... mkdir '../files/SQLite'`, recreate it: `sudo mkdir -p /files/SQLite && sudo chown -R "$(id -u):$(id -g)" /files`.
- **Lint/type-check/test commands** are the standard `pnpm run lint`, `pnpm run type-check`, and `pnpm test` (see `package.json`). `pnpm test` runs two Jest projects: `db` (real `better-sqlite3`) and `rn` (`jest-expo`).
- **Metro dev server:** `pnpm run dev:start` (`rock start`) serves on port `8081`. You can prove the whole app compiles without a device by fetching the bundle: `curl "http://localhost:8081/index.bundle?platform=android&dev=true&minify=false"` (expect HTTP 200).
- **No native Android/iOS run in this VM.** There is no Android SDK/`adb`, no emulator, and no Nix. `pnpm run dev:android` / `build:release:android` cannot run here; native device/emulator testing must happen on a host with the Android toolchain (or via the `flake.nix` Nix shell). JS/TS dev (lint, type-check, tests, Metro bundling) is fully supported.
