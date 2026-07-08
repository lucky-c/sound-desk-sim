# Contributing to Sound Desk Sim

Thanks for your interest in improving Sound Desk Sim! This is a small,
friendly project — issues, ideas, and pull requests are all welcome.

## Prerequisites

- [Bun](https://bun.sh) (the package manager and test runner). The pinned
  version is in `package.json`'s `packageManager` field.
- A modern browser with Web Audio + WebGL (any recent Chrome/Firefox/Safari).

## Getting started

```sh
bun install
bun run dev      # dev server — open the printed URL and click Play
```

Browsers keep audio suspended until you interact, so **Play** is the gesture
that starts sound. Turn your volume down first.

## Everyday commands

```sh
bun run dev        # Vite dev server
bun run typecheck  # vue-tsc, no emit
bun run test       # unit tests (tests/)
bun run test:e2e   # Playwright smoke tests (e2e/)
bun run build      # typecheck + production build
bun run preview    # serve the production build locally
```

Before opening a PR, please make sure these pass:

```sh
bun run typecheck && bun run test && bun run build
```

CI (`.github/workflows/ci.yml`) runs the same checks plus the e2e suite on
every pull request.

## How the code is organized

The golden rule: **the UI never touches Web Audio nodes directly.** Components
write to a Pinia store, the store calls the audio engine, and the engine sets
Web Audio parameters with click-free ramps. See the diagrams in the
[README](README.md#how-it-works) for the full picture.

- `src/components/` — Vue 3 components (`<script setup>`, Composition API).
- `src/stores/` — Pinia stores (`mixer`, `stage`, `challenges`, `soundLibrary`)
  — the single source of truth for every parameter.
- `src/audio/` — the Web Audio engine, instrument synthesis, spatial math, and
  IndexedDB persistence. This is the only layer that talks to Web Audio.
- `src/composables/` — small cross-cutting bits (hotkeys, shared UI state).
- `src/challenges/` — the guided-scenario data and types.
- `tests/` — unit tests. `e2e/` — Playwright browser tests.

## Coding conventions

- **TypeScript + Vue 3 `<script setup>`.** Match the style of the file you're
  editing (indentation, naming, comment density).
- **Route all parameter changes through the stores**, never by mutating audio
  nodes from a component. Stores apply changes via ramped setters.
- Keep audio parameter changes click-free (use the engine's ramp helpers).
- Two-space indentation, LF line endings (see `.editorconfig`).

## Adding a challenge

Challenges are plain data: append an object to the array in
[`src/challenges/data.ts`](src/challenges/data.ts) — see
[`src/challenges/types.ts`](src/challenges/types.ts) for the shape. No engine
changes needed.

## Pull requests

1. Fork and create a topic branch from `main`.
2. Make your change; keep it focused. Add or update tests where it makes sense.
3. Run typecheck, tests, and build locally.
4. Open a PR describing **what** changed and **why**. Screenshots or a short
   clip help a lot for UI changes.

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
