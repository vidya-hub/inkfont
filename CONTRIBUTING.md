# Contributing

## Setup

```sh
npm install
npm test
npm run test:e2e
npm run test:e2e:offline
```

Use Node 22+. Do not commit third-party font files unless redistribution rights are documented in the pull request.

## Where to change things

- Font, storage, geometry, tracing: `src/core/`
- UI: `src/workspace/`
- Keep React out of `src/core/`
- Edits go through `useDocument.edit` so undo and persistence stay consistent

## Tests

- Geometry, import UPM, persistence, and tracing belong in `tests/core.test.ts`
- Studio flows belong in `e2e/studio.spec.ts` (dev server)
- Service worker / offline flows belong in `e2e/offline.spec.ts` (production preview)

## Pull requests

- Run `npm test`, `npm run build`, and the e2e suites
- Do not add accounts, backends, or telemetry
- User-created fonts are not covered by the MIT license of this repo
