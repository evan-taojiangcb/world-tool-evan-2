# Word Tool Evan 2

Chrome extension for word/phrase lookup, favorite collection, and in-page highlight review.

## Monorepo Structure

- `apps/extension`: Chrome extension (Manifest V3, React + TypeScript)
- `apps/api`: Next.js API routes for dictionary and collection sync
- `packages/shared`: shared types and utilities
- `docs`: product and architecture docs

## Quick Start

1. Install dependencies

```bash
npm install
```

2. Run extension dev build

```bash
npm run dev:extension
```

3. Run API

```bash
npm run dev:api
```

4. Build extension

```bash
npm run build:extension
```

## Chrome Load (Developer Mode)

- Open `chrome://extensions`
- Enable Developer mode
- Click `Load unpacked`
- Select `apps/extension/dist`

## Notes

- First click on extension icon asks username and stores in `chrome.storage.local`.
- Favorites are cached in IndexedDB via localForage.
- Background worker proxies API calls and owns sync queue.
