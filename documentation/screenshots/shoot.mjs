// Takes the screenshots of the documentation on a local Otoroshi, with a fake Clever Cloud.
//
//   npm run setup   # once: installs playwright and its chromium build
//   npm run shoot   # writes ../static/img/screenshots/reaper-*.png
//
// The Otoroshi must run with the extension, and talk to the fake Clever Cloud this script starts:
//
//   CLEVER_CLOUD_API_URL=http://127.0.0.1:9990 CLEVER_CLOUD_API_TOKEN=demo
//
// The script creates a dozen demo routes (ids `route_reaper_demo_*`, domains `*.acme.oto.tools`), waits
// for their apps to reach every state, puts one to sleep and wakes it up for real, takes the
// screenshots, then disables the reaper on them and deletes them. Your other routes are not touched.
//
// Overrides via env: OTO_URL, OTO_USER, OTO_PASSWORD, SHOT_THEME (dark|light), SHOT_ONLY (a regex on
// the screenshot names), SHOT_KEEP=true (keep the demo routes), FAKE_API_PORT (9990),
// FAKE_BACKEND_PORT (9991).

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { startFakeClever } from './fake-clever.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../static/img/screenshots');
mkdirSync(OUT, { recursive: true });

const BASE = (process.env.OTO_URL || 'http://otoroshi.oto.tools:9999').replace(/\/$/, '');
const USER = process.env.OTO_USER || 'admin@otoroshi.io';
const PASSWORD = process.env.OTO_PASSWORD || 'password';
const THEME = process.env.SHOT_THEME === 'light' ? 'light' : 'dark';
const ONLY = process.env.SHOT_ONLY ? new RegExp(process.env.SHOT_ONLY) : null;
const KEEP = process.env.SHOT_KEEP === 'true';
const GATEWAY_PORT = new URL(BASE).port || '80';

const VIEWPORT = { width: 1568, height: 950 };
const PAGE_VIEWPORT = { width: 1280, height: 800 };

const REAPER = '/extensions/cloud-apim/extensions/clevercloud-reaper';
const CONSOLE = `${BASE}/bo/dashboard/extensions/cloud-apim/clevercloud-reaper`;
const PLUGIN = 'cp:otoroshi_plugins.com.cloud.apim.otoroshi.extensions.clevercloudreaper.CleverCloudReaper';
const PREFIX = 'route_reaper_demo_';
const FEATURED = `${PREFIX}analytics-dashboard`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wanted = (name) => !ONLY || ONLY.test(name);
const DOMAIN = 'acme.oto.tools';
const front = (slug) => `${slug}.${DOMAIN}`;

// ---------------------------------------------------------------------------------------------
// otoroshi, through the session of the backoffice
// ---------------------------------------------------------------------------------------------

async function login(page) {
  await page.goto(`${BASE}/bo/simple/login`, { waitUntil: 'networkidle' });
  if (!page.url().includes('/login')) return;
  await page.waitForSelector('input[name="email"]', { timeout: 15000 });
  await page.fill('input[name="email"]', USER);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), page.click('button[type="submit"]')]);
}

/**
 * A call with the session of the backoffice. Through playwright rather than the page: the backoffice
 * wraps `fetch`, and a dev build throws on every error status.
 */
async function call(page, method, path, body) {
  const res = await page.request.fetch(`${BASE}${path}`, {
    method,
    headers: { Accept: 'application/json' },
    // a content-type without a body gets a 400 from the admin api proxy
    ...(body === undefined ? {} : { data: body }),
    failOnStatusCode: false,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {}
  return { status: res.status(), json, text: text.slice(0, 300) };
}

/** The demo routes: the reaper on most, in every mode, and two routes it does not manage. */
function demoRoutes(fake) {
  const app = (slug) => fake.apps.find((a) => a.slug === slug);
  const reaper = (slug, config, enabled = true) => ({ plugin: PLUGIN, enabled, config: { app_id: app(slug).id, ...config } });
  return [
    // put to sleep after a minute, then woken up by the screenshot of the waiting page
    { slug: 'analytics-dashboard', target: 'analytics-dashboard', reaper: reaper('analytics-dashboard', { grace_period: 60 }) },
    {
      slug: 'analytics-dashboard-api',
      target: 'analytics-dashboard',
      reaper: reaper('analytics-dashboard', { grace_period: 60, allow_waiting_page: false, api_behavior: 'unavailable' }),
    },
    { slug: 'shop-staging', reaper: reaper('shop-staging', { grace_period: 3600 }) },
    { slug: 'billing-recette', reaper: reaper('billing-recette', { grace_period: 3600 }) },
    { slug: 'docs-preview', reaper: reaper('docs-preview', { grace_period: 60 }) },
    { slug: 'partner-portal-demo', reaper: reaper('partner-portal-demo', { grace_period: 60 }) },
    { slug: 'mobile-api-dev', reaper: reaper('mobile-api-dev', { grace_period: 1800, api_behavior: 'unavailable' }) },
    { slug: 'crm-sandbox', reaper: reaper('crm-sandbox', { grace_period: 60 }) },
    { slug: 'intranet-dev', reaper: reaper('intranet-dev', { grace_period: 3600 }) },
    { slug: 'legacy-backoffice', reaper: reaper('legacy-backoffice', { grace_period: 60 }) },
    { slug: 'ml-notebooks', reaper: reaper('ml-notebooks', { grace_period: 3600 }) },
    { slug: 'summer-campaign', reaper: reaper('summer-campaign', { grace_period: 3600 }, false) },
    { slug: 'auth-service', backend: 'auth.internal.acme.example' },
    { slug: 'public-website', backend: 'www-origin.acme.example' },
  ];
}

async function deleteDemoRoutes(page) {
  const all = await call(page, 'GET', '/bo/api/proxy/api/routes');
  const demo = (all.json || []).filter((r) => r.id.startsWith(PREFIX));
  for (const r of demo) {
    // releases the app first: a sleeping app is started, and forgotten
    if ((r.plugins || []).some((p) => p.plugin === PLUGIN && p.enabled)) await call(page, 'POST', `${REAPER}/routes/${r.id}/_disable`);
    await call(page, 'DELETE', `/bo/api/proxy/api/routes/${r.id}`);
  }
  return demo.length;
}

async function createDemoRoutes(page, fake) {
  const template = (await call(page, 'GET', '/bo/api/proxy/api/routes/_template')).json;
  for (const r of demoRoutes(fake)) {
    const route = JSON.parse(JSON.stringify(template));
    route.id = `${PREFIX}${r.slug}`;
    route.name = r.slug;
    route.description = `the ${r.slug} app`;
    route.tags = ['reaper-demo'];
    route.frontend.domains = [front(r.slug)];
    const target = { ...route.backend.targets[0] };
    target.id = 'target_1';
    target.hostname = r.backend || `${r.target || r.slug}-app.oto.tools`;
    target.port = r.backend ? 443 : fake.backendPort;
    target.tls = !!r.backend;
    route.backend.targets = [target];
    route.plugins = [{ plugin: 'cp:otoroshi.next.plugins.OverrideHost', enabled: true, config: {} }];
    if (r.reaper) route.plugins.push(r.reaper);
    const res = await call(page, 'POST', '/bo/api/proxy/api/routes', route);
    if (res.status > 299) throw new Error(`could not create the route ${r.slug}: ${res.status} ${res.text}`);
  }
}

async function rows(page) {
  const res = await call(page, 'GET', `${REAPER}/routes?filter.frontend=${DOMAIN}&page_size=50`);
  return Object.fromEntries((res.json?.items || []).map((r) => [r.name, r]));
}

async function waitFor(what, page, predicate, timeout = 240000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const r = await rows(page);
    if (predicate(r)) return r;
    if (Date.now() > deadline) {
      const now = Object.values(r).map((x) => `${x.name}: ${x.status_label || '-'}`).join(', ');
      throw new Error(`timed out waiting for ${what} (${now})`);
    }
    await sleep(2000);
  }
}

// ---------------------------------------------------------------------------------------------
// screenshots
// ---------------------------------------------------------------------------------------------

async function settle(page, ms = 900) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(ms);
}

/**
 * The height that shows the whole page without scrolling. The backoffice scrolls its content in a
 * container rather than the document: that is the one to measure, from the top.
 */
async function fullHeight(page) {
  return page.evaluate(() => {
    const container = document.getElementById('content-scroll-container');
    if (!container) return document.documentElement.scrollHeight;
    container.scrollTop = 0;
    return Math.ceil(container.getBoundingClientRect().top + container.scrollHeight);
  });
}

async function shoot(page, name, { fullPage = false } = {}) {
  if (!wanted(name)) return;
  const file = resolve(OUT, `${name}.png`);
  if (fullPage) {
    // a window as tall as the page, rather than playwright's stitching, so the sidebar and the fixed
    // button bar render where they belong
    const height = await fullHeight(page);
    const viewport = page.viewportSize();
    await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, height) });
    await page.waitForTimeout(600);
    await page.screenshot({ path: file });
    await page.setViewportSize(viewport);
  } else {
    await page.screenshot({ path: file });
  }
  console.log(`  ✓ ${name}.png`);
}

/** One section of the route page: from its title to the next one, or to the end of the history. */
async function shootSection(page, name, from, to) {
  if (!wanted(name)) return;
  const viewport = page.viewportSize();
  const height = await fullHeight(page);
  await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, height) });
  await page.addStyleTag({ content: '.displayGroupBtn { display: none !important; }' });
  await page.waitForTimeout(600);
  const clip = await page.evaluate(
    ({ from, to }) => {
      // the section titles are the spans of the collapsible rows of the otoroshi forms
      const titles = [...document.querySelectorAll('form .col-sm-10 > span, form .col-sm-10 span')].filter(
        (e) => e.children.length === 0
      );
      const title = (text) => titles.find((e) => e.textContent.trim() === text);
      const start = title(from).closest('.row');
      const form = start.closest('form');
      const top = start.getBoundingClientRect().top - 8;
      let bottom;
      if (to) bottom = title(to).closest('.row').getBoundingClientRect().top - 8;
      else bottom = form.parentElement.getBoundingClientRect().bottom + 8;
      const box = form.getBoundingClientRect();
      return { x: Math.max(0, box.left - 16), y: Math.max(0, top), width: box.width + 32, height: bottom - top };
    },
    { from, to }
  );
  await page.screenshot({ path: resolve(OUT, `${name}.png`), clip });
  await page.setViewportSize(viewport);
  console.log(`  ✓ ${name}.png`);
}

async function routePage(page, id) {
  await page.goto(`${CONSOLE}/edit/${id}`, { waitUntil: 'networkidle' });
  await settle(page, 1500);
}

/** A browser on a sleeping app: the waiting page, as its users see it. */
async function waitingPage(browser, slug, scheme, name, { until } = {}) {
  const context = await browser.newContext({ viewport: PAGE_VIEWPORT, colorScheme: scheme });
  const page = await context.newPage();
  await page.goto(`http://${front(slug)}:${GATEWAY_PORT}/`, { waitUntil: 'load' });
  if (until) await until(page);
  else await page.waitForTimeout(6500); // one poll: the status reads the wake up in progress
  await shoot(page, name);
  return { page, context };
}

// ---------------------------------------------------------------------------------------------

const run = async () => {
  const apiPort = Number(process.env.FAKE_API_PORT || 9990);
  const fake = await startFakeClever({
    apiPort,
    backendPort: Number(process.env.FAKE_BACKEND_PORT || 9991),
    log: (m) => console.log(`    clever: ${m}`),
  });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: THEME });
  await context.addInitScript((theme) => {
    try {
      window.localStorage.setItem('otoroshi-dark-light-mode', theme);
    } catch (e) {}
  }, THEME);
  const page = await context.newPage();
  let traffic = null;

  try {
    console.log(`→ ${BASE} as ${USER} (${THEME} theme)`);
    await login(page);

    const overview = (await call(page, 'GET', `${REAPER}/overview`)).json;
    if (!overview) throw new Error('the Clever Cloud Reaper extension does not answer: is it installed and enabled?');
    if (!overview.token_configured || overview.api_url.replace(/\/$/, '') !== fake.apiUrl) {
      throw new Error(
        `the reaper talks to ${overview.api_url}, not to the fake Clever Cloud.\n` +
          `  Restart Otoroshi with CLEVER_CLOUD_API_URL=${fake.apiUrl} CLEVER_CLOUD_API_TOKEN=demo`
      );
    }

    console.log('→ creating the demo routes');
    await deleteDemoRoutes(page);
    await createDemoRoutes(page, fake);
    // what a previous run may have left: read again from the fake clever cloud
    for (const app of fake.apps) await call(page, 'POST', `${REAPER}/apps/${app.id}/_reset`);

    // a busy app
    traffic = setInterval(() => fetch(`http://${front('shop-staging')}:${GATEWAY_PORT}/products`).catch(() => {}), 4000);

    console.log('→ waiting for the apps to reach every state (about two minutes)');
    await waitFor('every state', page, (r) =>
      r['analytics-dashboard']?.status_label === 'Asleep' &&
      r['crm-sandbox']?.status_label === 'Going to sleep' &&
      r['mobile-api-dev']?.status_label === 'Waking up' &&
      r['intranet-dev']?.status_label === 'Error' &&
      r['ml-notebooks']?.status_label === 'Initializing' &&
      r['docs-preview']?.status_label === 'Asleep' &&
      r['partner-portal-demo']?.status_label === 'Asleep' &&
      r['legacy-backoffice']?.status_label === 'Asleep' &&
      r['shop-staging']?.status_label === 'Up'
    );
    // the costs are read from the fake clever cloud, a few apps at each full run of the job
    for (let i = 0; i < 60; i++) {
      const savings = (await call(page, 'GET', `${REAPER}/savings`)).json;
      if (savings && savings.asleep >= 4) break;
      await sleep(2000);
    }

    console.log('capturing…');
    // the routes, filtered on the demo
    if (wanted('reaper-routes')) {
      await page.goto(CONSOLE, { waitUntil: 'networkidle' });
      await settle(page, 1200);
      const filter = page.locator('.rt-thead.-filters input').nth(1);
      await filter.fill(DOMAIN);
      await settle(page, 1800);
      await shoot(page, 'reaper-routes');
    }

    // a browser wakes the app up: the waiting page, until it reloads on the app
    const woken = await waitingPage(browser, 'analytics-dashboard', 'light', 'reaper-waiting-page');
    console.log('  waiting for the page to reload on the app…');
    await woken.page.waitForEvent('load', { timeout: 120000 });
    if (await woken.page.locator('#clevercloud-reaper-status').count()) throw new Error('the waiting page reloaded on itself');
    console.log('  reloaded on the app');
    await woken.context.close();
    await waitFor('the app to be up', page, (r) => r['analytics-dashboard']?.status_label === 'Up', 60000);

    // the settings a real route would have
    await call(page, 'PUT', `${REAPER}/routes/${FEATURED}/config`, {
      grace_period: 1800,
      timezone: 'Europe/Paris',
      must_be_up_at: [{ days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], start: '08:30', end: '09:30' }],
      monitoring_filters: [
        { source: 'path', regex: '^/health$' },
        { source: 'user_agent', regex: 'UptimeRobot|Pingdom' },
      ],
    });
    await call(page, 'PUT', `${REAPER}/routes/${PREFIX}analytics-dashboard-api/config`, { grace_period: 1800 });
    // the state of the app takes the new grace period at the next run of the job
    await waitFor('the new grace period', page, (r) => r['analytics-dashboard']?.state?.grace_period === 1800000, 90000);

    // the page of the route: status, settings, history
    await routePage(page, FEATURED);
    await shoot(page, 'reaper-route', { fullPage: true });
    await routePage(page, FEATURED);
    await shootSection(page, 'reaper-route-status', 'Status', 'Clever Cloud app');
    await routePage(page, FEATURED);
    await shootSection(page, 'reaper-route-history', 'History');
    // the savings of an app still asleep: what it costs, and what its sleep saved so far
    await routePage(page, `${PREFIX}partner-portal-demo`);
    await shootSection(page, 'reaper-route-savings', 'Savings', 'Clever Cloud app');

    // a route without the reaper
    await routePage(page, `${PREFIX}auth-service`);
    await shoot(page, 'reaper-route-enable', { fullPage: true });

    // the plugin in the route designer
    if (wanted('reaper-plugin')) {
      await page.goto(`${BASE}/bo/dashboard/routes/${FEATURED}?tab=flow`, { waitUntil: 'networkidle' });
      await settle(page, 1500);
      await page.locator('.dot', { hasText: 'Clever Cloud Reaper' }).first().click();
      await settle(page, 1500);
      await shoot(page, 'reaper-plugin');
    }

    // the waiting page in the dark, and when the app cannot start
    const dark = await waitingPage(browser, 'docs-preview', 'dark', 'reaper-waiting-page-dark');
    await dark.context.close();
    const failed = await waitingPage(browser, 'legacy-backoffice', 'light', 'reaper-waiting-page-error', {
      until: (p) =>
        p.waitForFunction(() => document.body.classList.contains('clevercloud-reaper-error'), null, { timeout: 90000, polling: 1000 }),
    });
    await failed.context.close();
  } finally {
    if (traffic) clearInterval(traffic);
    if (!KEEP) {
      const n = await deleteDemoRoutes(page).catch(() => 0);
      if (n) console.log(`→ deleted the ${n} demo routes`);
      await sleep(1000);
    }
    await browser.close();
    fake.close();
  }
  console.log(`\nDone. Wrote to ${OUT}`);
  // something (a keep-alive socket, playwright) can keep the event loop alive: the work is done
  process.exit(0);
};

run().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
