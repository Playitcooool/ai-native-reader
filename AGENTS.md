# Repository Guidelines

## Project Structure & Module Organization

RustyBooks is a Tauri v2 desktop app with a React/TypeScript frontend and Rust backend.

- `src/` contains the frontend. Components live in `src/components/`, Zustand stores in `src/stores/`, and domain logic in `src/features/` (`pdf/`, `ai/`, `toc/`, `citations/`, `ink/`, `epub/`).
- `src-tauri/src/` contains Rust commands, database migrations, PDF/EPUB helpers, and AI provider code.
- `tests/` contains Vitest unit tests for pure frontend logic.
- `public/`, `docs/`, and `src-tauri/assets/` hold static assets, screenshots, and bundled OCR data.

## Build, Test, and Development Commands

- `npm install` installs frontend and Tauri CLI dependencies.
- `npm run dev` starts the Vite frontend only on port `1420`.
- `npm run tauri dev` runs the full desktop app.
- `npm test` runs Vitest tests.
- `npm run build` runs TypeScript checking and a Vite production build.
- `npm run tauri:build` creates the production desktop bundle.
- From `src-tauri/`, run `cargo test` for Rust tests.

Agents should prefix shell commands with `rtk` when possible, for example `rtk npm test`.

## Coding Style & Naming Conventions

Use TypeScript, React function components, and existing Zustand patterns. Keep shared logic in `src/features/` when it can be tested without rendering. Prefer small, direct helpers over new abstraction layers. Component files use `PascalCase.tsx`; utility modules use `camelCase.ts`; tests use `*.test.ts`.

Rust code follows `cargo fmt`. Keep Tauri commands grouped by domain under `src-tauri/src/commands/`.

## Testing Guidelines

Use Vitest for frontend logic tests in `tests/`. Keep tests pure and fast; avoid DOM setup unless the behavior needs it. Add focused tests for parsers, range/page logic, and helper functions. Run `npm test` before frontend commits and `cargo test` after Rust changes.

## Commit & Pull Request Guidelines

Recent commits use short imperative subjects, for example `Improve AI reading companion UX` and `Fix explicit page range AI questions`. Keep commits focused and describe user-visible behavior or the root fix.

Pull requests should include a concise summary, test results, linked issues when relevant, and screenshots or screen recordings for UI changes.

## Security & Configuration Tips

Provider API keys and base URLs are configured in-app through Settings. Do not commit local secrets, generated bundles, or machine-specific paths.
