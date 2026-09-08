# Architecture

Inkfont splits engine code from UI. React never owns font bytes.

## Layout

| Path | Role |
|---|---|
| `src/core/` | Project model, geometry, font parse/compile, IndexedDB, workers, tracing, worksheets |
| `src/workspace/` | Studio UI: canvas, properties, proof, dialogs, offline banner |
| `src/lib/ink/` | Brush ribbon and legacy boolean helpers used by migration and the worker |
| `e2e/` | Playwright studio tests (dev) and offline tests (preview) |
| `tests/` | Vitest geometry, import/export, persistence, tracing |

## Document model

`FontProject` (`src/core/model.ts`) has a stable `id`, `schemaVersion`, monotonic `revision`, `metrics`, `glyphs`, Unicode `mappings`, and `kerning`. Glyph ids are independent of Unicode so unencoded components and later ligatures can exist. `validateProject` runs before load and before each edit.

## Storage

`ProjectRepository` keeps metadata in IndexedDB store `projects` and glyphs in `glyphs` keyed `projectId:glyphId`. Saves are transactional and fail with `CONFLICT` when `expected` revision does not match. `localStorage` holds only `inkfont.active`. A leftover `inkfont-project` key is migrated once, then left in place until you delete it.

`.inkfont` is a zip (`manifest.json` + `project.json`) via `fflate`. Opening a backup assigns a new id and revision 0.

## Workers

`runJob` (`src/core/jobs.ts`) starts a module worker per call, tags the message with `{ id, revision }`, and ignores mismatched replies. Operations: `parse`, `compile`, `trace`, `fit`, `erase`, `union`, `brush`, `markers`, `rectify`.

Boolean erase/union flatten through Clipper, then `fitContour` rebuilds cubics. Objects with no intersection keep their original contour identity.

## Offline

The Vite `inkfont-offline` plugin writes `dist/sw.js` after build. The first install calls `skipWaiting`; later updates wait for **Save & update**, which flushes IndexedDB first. Dev mode does not register a service worker.

## Export

`compileFont` writes CFF OpenType (opentype.js has no glyf writer), copies stored vertical metrics into `hhea`/`OS/2`, and appends a `kern` table when pairs exist. Open contours are rejected. A `.notdef` box is always included.
