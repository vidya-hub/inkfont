# Inkfont

Draw, trace, or scan lettering in the browser and download an OpenType font. Work stays on this device. There are no accounts, servers, or telemetry.

Application code is MIT. Fonts you create belong to you. Inkfont does not bundle third-party fonts.

## Requirements

- Node.js 22+
- A current Chromium, Firefox, or Safari / WebKit browser

## Setup

```sh
npm install
npm run dev
```

Open the printed URL (Vite defaults to `http://127.0.0.1:5173`).

```sh
npm test                 # unit tests
npm run test:e2e         # studio tests against the dev server
npm run test:e2e:offline # production build + service worker, then offline
npm run build
npm run preview          # serves dist/ (service worker registers here, not in dev)
```

## Two different downloads

| Action | File | What it is |
|---|---|---|
| **Export font** | `.otf` | A compiled OpenType font for installers and apps. Missing glyphs are omitted; fallback is up to the app that loads the font. |
| **Download editable backup** | `.inkfont` | A zip of editable geometry, metrics, mappings, and references. Restore it from Projects → Open backup. |

Browser storage can be evicted. Keep an `.inkfont` backup of work you care about.

## Privacy

Parsing, tracing, compiling, and saving run in this browser (IndexedDB + optional service worker). Nothing is uploaded.

## License

MIT. See [LICENSE](LICENSE).
