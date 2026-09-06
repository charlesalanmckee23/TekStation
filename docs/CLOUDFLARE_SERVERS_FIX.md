# TekStation Cloudflare Servers API fix

This build includes two Cloudflare-compatible server API paths:

- `_worker.js` at the project root for Pages Advanced Mode. This works with current Cloudflare dashboard Drag & Drop/Direct Upload deployments and serves static assets through `env.ASSETS.fetch()` while handling `/api/servers` itself.
- `functions/api/servers.js` for normal Git-integrated Pages Functions deployments.

## Deploying with Cloudflare Pages dashboard

Upload the **contents of this folder as the Pages output**. The important file is the root `_worker.js`; do not move it into `functions/`.

After deployment, test these URLs:

- `/api/health` should return JSON with `"ok":true`.
- `/api/servers` should return JSON containing a non-empty `servers` array when Wildcard's endpoint is available.

## Why `sw.js` was changed

The previous service worker intercepted all same-origin GET requests and could treat `/api/servers` as a static-shell request. It now explicitly leaves `/api/*` alone, and the cache version is bumped to `asa-v100` so browsers install the corrected service worker.

## Git-integrated Pages

If the Pages project is connected to Git, you can use the normal `functions/api/servers.js` route. Because `_worker.js` activates Pages Advanced Mode when deployed, do not mix deployment modes unintentionally: the root `_worker.js` is intentionally the self-contained route handler for this package.
