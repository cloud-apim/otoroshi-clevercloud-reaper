// A fake Clever Cloud for the screenshots: just enough of the api for the reaper, over a dozen apps in
// every state, and the backends of those apps.
//
//   node fake-clever.mjs    # alone, to play with it: api on :9990, backends on :9991
//
// Point Otoroshi at it with CLEVER_CLOUD_API_URL=http://127.0.0.1:9990 (any CLEVER_CLOUD_API_TOKEN).
// A backend is picked by the Host it is called with: `<slug>-app.oto.tools`, which resolves to
// 127.0.0.1 like every *.oto.tools name.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const ACME = 'orga_3c5e7a91-2b4d-4f6a-8c1e-5d7f9b2a4c6e';
const LABS = 'orga_8a1f3d5b-7c9e-4b2a-9d4f-6e8a0c2b4d6f';
const OWNERS = [
  { id: ACME, name: 'Acme Corp' },
  { id: LABS, name: 'Acme Labs' },
];

const deployment = (state, action, at = Date.now()) => ({ uuid: `deployment-${at}`, state, action, date: at });

// the real prices of the par zone, in euros per hour and per instance
const PRICES = { pico: 0.00625, nano: 0.0083333, XS: 0.0222222, S: 0.0444444, M: 0.1055556, L: 0.2111111, XL: 0.4222222 };

/**
 * The apps, by the state the console ends up showing for them:
 *  - startDelay / startOutcome: what a start does;
 *  - stopDelay: how long a stop takes (the app stays SHOULD_BE_UP meanwhile);
 *  - visible: false when the token cannot see the app.
 */
export function demoApps() {
  const app = (n, slug, owner, state, last, more = {}) => ({
    id: `app_${n.toString(16).padStart(8, '0')}-6b1d-4c2e-9f3a-0d5e7b9c1a3f`,
    slug,
    name: slug,
    owner,
    state,
    deployment: last,
    startDelay: 20000,
    startOutcome: 'OK',
    stopDelay: 0,
    visible: true,
    flavor: 'XS',
    instances: 1,
    ...more,
  });
  const hour = 3600000;
  return [
    // the app of the route the docs show: put to sleep and woken up for real during the shoot
    app(1, 'analytics-dashboard', ACME, 'SHOULD_BE_UP', deployment('OK', 'DEPLOY', Date.now() - 3 * hour), { flavor: 'S' }),
    app(2, 'shop-staging', ACME, 'SHOULD_BE_UP', deployment('OK', 'DEPLOY', Date.now() - 5 * hour), { flavor: 'M', instances: 2 }),
    app(3, 'billing-recette', ACME, 'SHOULD_BE_UP', deployment('OK', 'DEPLOY', Date.now() - 2 * hour), { flavor: 'S' }),
    // put to sleep by the reaper during the shoot, so their sleep counts as saved
    app(4, 'docs-preview', LABS, 'SHOULD_BE_UP', deployment('OK', 'DEPLOY', Date.now() - 6 * hour), { startDelay: 60000 }),
    app(5, 'partner-portal-demo', ACME, 'SHOULD_BE_UP', deployment('OK', 'DEPLOY', Date.now() - 48 * hour), { flavor: 'M', instances: 2 }),
    // starting, for ever
    app(6, 'mobile-api-dev', LABS, 'WANTS_TO_BE_UP', deployment('WIP', 'DEPLOY')),
    // its stop takes ten minutes
    app(7, 'crm-sandbox', ACME, 'SHOULD_BE_UP', deployment('OK', 'DEPLOY', Date.now() - 6 * hour), { stopDelay: 600000 }),
    // its last start failed
    app(8, 'intranet-dev', ACME, 'WANTS_TO_BE_UP', deployment('FAIL', 'DEPLOY', Date.now() - 3 * hour)),
    // put to sleep during the shoot too, and its start fails
    app(9, 'legacy-backoffice', LABS, 'SHOULD_BE_UP', deployment('OK', 'DEPLOY', Date.now() - 24 * hour), {
      startDelay: 5000,
      startOutcome: 'FAIL',
      flavor: 'L',
    }),
    // the token cannot see it
    app(10, 'ml-notebooks', LABS, 'SHOULD_BE_UP', deployment('OK', 'DEPLOY'), { visible: false }),
    // the reaper is disabled on its route
    app(11, 'summer-campaign', ACME, 'SHOULD_BE_UP', deployment('OK', 'DEPLOY', Date.now() - 480 * hour)),
  ];
}

function send(res, status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json', ...headers });
  res.end(text);
}

function appPage(app, path) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${app.name}</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f4f4f8;color:#1d1d2b}</style>
</head><body><main><h1>${app.name}</h1><p>Served by the app, path <code>${path}</code>.</p></main></body></html>`;
}

export async function startFakeClever({ apiPort = 9990, backendPort = 9991, log = () => {} } = {}) {
  const apps = demoApps();
  const visible = (id) => apps.find((a) => a.id === id && a.visible);
  const appJson = (a) => ({
    id: a.id,
    name: a.name,
    ownerId: a.owner,
    state: a.state,
    vhosts: [{ fqdn: `${a.slug}-app.oto.tools` }],
    zone: 'par',
    instance: {
      minInstances: a.instances,
      maxInstances: a.instances,
      minFlavor: { name: a.flavor, price_id: `apps.${a.flavor}` },
      maxFlavor: { name: a.flavor, price_id: `apps.${a.flavor}` },
    },
  });

  const api = createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (!/^Bearer .+/.test(req.headers.authorization || '')) return send(res, 401, { message: 'unauthorized' });
    if (req.method === 'GET' && path === '/v2/summary') {
      return send(res, 200, {
        user: { id: 'user_demo', name: 'demo', applications: [] },
        organisations: OWNERS.map((o) => ({
          id: o.id,
          name: o.name,
          applications: apps.filter((a) => a.owner === o.id && a.visible).map((a) => ({ id: a.id, name: a.name, state: a.state })),
        })),
      });
    }
    // the prices of clever cloud, per instance and per hour
    if (req.method === 'GET' && path === '/v4/billing/price-system') {
      const runtime = Object.entries(PRICES).map(([flavor, price]) => ({ source: 'apps', flavor, slug_id: `apps.${flavor}`, time_unit: 'PT1H', price }));
      return send(res, 200, { zone_id: 'par', currency: 'EUR', runtime, countable: [] });
    }
    let m = path.match(/^\/v2\/organisations\/([^/]+)\/applications$/);
    if (req.method === 'GET' && m) return send(res, 200, apps.filter((a) => a.owner === m[1] && a.visible).map(appJson));
    m = path.match(/^\/v2\/organisations\/[^/]+\/applications\/([^/]+)(\/.*)?$/);
    const app = m && visible(m[1]);
    if (!app) return send(res, 404, { message: `not found: ${req.method} ${path}` });
    const action = m[2] || '';
    if (req.method === 'GET' && action === '') return send(res, 200, appJson(app));
    if (req.method === 'GET' && action === '/deployments') return send(res, 200, [app.deployment]);
    if (req.method === 'DELETE' && action === '/instances') {
      log(`stop ${app.name}`);
      const done = () => {
        app.state = 'SHOULD_BE_DOWN';
        app.deployment = deployment('OK', 'UNDEPLOY');
      };
      if (app.stopDelay > 0) setTimeout(done, app.stopDelay);
      else done();
      return send(res, 200, { id: 200, message: 'The application has been stopped', type: 'success' });
    }
    if (req.method === 'POST' && action === '/instances') {
      log(`start ${app.name}`);
      const at = Date.now();
      app.state = 'WANTS_TO_BE_UP';
      app.deployment = deployment('WIP', 'DEPLOY', at);
      setTimeout(() => {
        app.deployment = deployment(app.startOutcome, 'DEPLOY', at);
        app.state = app.startOutcome === 'OK' ? 'SHOULD_BE_UP' : 'SHOULD_BE_DOWN';
      }, app.startDelay);
      return send(res, 200, { deploymentId: `deployment-${at}` });
    }
    return send(res, 404, { message: `not found: ${req.method} ${path}` });
  });

  const backend = createServer((req, res) => {
    const host = (req.headers.host || '').split(':')[0].toLowerCase();
    const app = apps.find((a) => `${a.slug}-app.oto.tools` === host);
    // what clever cloud answers for an app with no instance
    if (!app || app.state !== 'SHOULD_BE_UP') return send(res, 404, '404 not found', { 'X-CleverCloudUpgrade': 'true' });
    return send(res, 200, appPage(app, req.url));
  });

  await new Promise((r) => api.listen(apiPort, '127.0.0.1', r));
  await new Promise((r) => backend.listen(backendPort, '127.0.0.1', r));
  return {
    apps,
    apiUrl: `http://127.0.0.1:${apiPort}`,
    backendPort,
    // otoroshi keeps its connections alive: close them too, or the process never ends
    close: () => {
      api.closeAllConnections();
      backend.closeAllConnections();
      api.close();
      backend.close();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fake = await startFakeClever({ log: (m) => console.log(`  ${m}`) });
  console.log(`fake clever cloud api on ${fake.apiUrl}, app backends on 127.0.0.1:${fake.backendPort}`);
}
