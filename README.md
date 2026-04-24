# Dunkin' Fleet Inventory Check

One button. Checks inventory on Grubhub for all 21 stores in ~2 seconds.

## What it is
- `index.html` — single-page UI, no build step
- `api/check.js` — Vercel serverless function, proxies Grubhub's public API (avoids browser CORS)
- `stores.json` — 21 store IDs

No database, no auth, no build.

## Deploy to Vercel
1. Push this folder to a new GitHub repo
2. Go to [vercel.com/new](https://vercel.com/new) and import the repo
3. Accept defaults → Deploy

Vercel auto-detects everything:
- Static files served from the root
- `api/*.js` runs as a serverless function at `/api/*`
- Node 18+ (for the built-in `fetch`)

## Local preview
```bash
npm i -g vercel
vercel dev
# → http://localhost:3000
```

## API
- `GET /api/check` → all 21 stores
- `GET /api/check?gh_id=2561073` → single store

Response caches for 30s at Vercel's edge, so rapid re-clicks are free.
