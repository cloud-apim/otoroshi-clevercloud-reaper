# Screenshots

Regenerates the `reaper-*.png` captures of the documentation, in
[`../static/img/screenshots`](../static/img/screenshots), by driving a local Otoroshi with
Playwright, against a fake Clever Cloud.

```sh
npm run setup     # once: installs Playwright and its Chromium build (~130 MB)
npm run shoot     # about four minutes
```

## What it needs

An Otoroshi with the extension on `http://otoroshi.oto.tools:9999`, whose reaper talks to the fake
Clever Cloud the script starts. Start that Otoroshi with:

```sh
CLEVER_CLOUD_API_URL=http://127.0.0.1:9990
CLEVER_CLOUD_API_TOKEN=demo
```

The script stops with a clear message if the reaper talks to another API.

## What it does

1. Starts [`fake-clever.mjs`](./fake-clever.mjs): the Clever Cloud API on `:9990` and the backends of
   its apps on `:9991`, a dozen apps that end up in every state (up, asleep, waking up, going to
   sleep, in error, initializing). Nothing talks to the real Clever Cloud.
2. Creates a dozen demo routes, ids `route_reaper_demo_*`, domains `*.acme.oto.tools`, the reaper on
   most of them. Your other routes are not touched.
3. Waits for every state, puts `analytics-dashboard` to sleep after a minute without traffic, and
   wakes it up from a browser: the waiting page you see in the docs is that one.
4. Captures the routes table, the page of a route (whole, status, history), a route without the
   reaper, the plugin in the route designer, and the waiting page (light, dark, in error).
5. Disables the reaper on the demo routes and deletes them.

## Overrides

| | |
|---|---|
| `OTO_URL` | the Otoroshi (default `http://otoroshi.oto.tools:9999`) |
| `OTO_USER` · `OTO_PASSWORD` | the backoffice credentials (default `admin@otoroshi.io` / `password`) |
| `SHOT_THEME` | `dark` (default) or `light`, for the backoffice |
| `SHOT_ONLY` | a regex on the capture names, to redo only some: `SHOT_ONLY='waiting' npm run shoot` |
| `SHOT_KEEP` | `true` to keep the demo routes afterwards |
| `FAKE_API_PORT` · `FAKE_BACKEND_PORT` | the ports of the fake Clever Cloud (`9990`, `9991`) |

`npm run fake-clever` starts the fake Clever Cloud alone, to play with it.

## The savings

Savings only show after weeks of real use, so `npm run shoot:savings` takes
`reaper-savings.png` and `reaper-route-savings.png` from the real console with demo answers: it
intercepts the calls of the console to the extension in the browser, and serves a year of savings
consistent with the apps of the fake Clever Cloud and the real prices of the `par` zone. It needs an
Otoroshi with the extension, whatever Clever Cloud api its reaper talks to, and writes nothing to it.
