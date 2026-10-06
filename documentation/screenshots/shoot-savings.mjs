// Takes the screenshots of the savings, which only show something after weeks of real use: the console
// is the real one, served by a local Otoroshi, but the answers of the extension are a demo, intercepted
// in the browser. Nothing is written to the Otoroshi, and its reaper can talk to any Clever Cloud api.
//
//   npm run shoot:savings   # writes ../static/img/screenshots/reaper-savings.png and reaper-route-savings.png
//
// Overrides via env: OTO_URL, OTO_USER, OTO_PASSWORD, SHOT_THEME (dark|light).

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { demoApps } from './fake-clever.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../static/img/screenshots');
mkdirSync(OUT, { recursive: true });

const BASE = (process.env.OTO_URL || 'http://otoroshi.oto.tools:9999').replace(/\/$/, '');
const USER = process.env.OTO_USER || 'admin@otoroshi.io';
const PASSWORD = process.env.OTO_PASSWORD || 'password';
const THEME = process.env.SHOT_THEME === 'light' ? 'light' : 'dark';
const API = '/extensions/cloud-apim/extensions/clevercloud-reaper';
const CONSOLE = `${BASE}/bo/dashboard/extensions/cloud-apim/clevercloud-reaper`;

const HOUR = 3600000;
const DAY = 24 * HOUR;
const now = Date.now();
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
const date = (ts) => new Date(ts).toISOString().slice(0, 10);

// the prices of the par zone, per instance and per hour
const PRICES = { XS: 0.0222222, S: 0.0444444, M: 0.1055556, L: 0.2111111 };

/** The demo, app by app: its size, its state, and how many hours a day it sleeps on weekdays. */
const DEMO = {
  'analytics-dashboard': { flavor: 'S', instances: 1, status: 'Up', night: 14, months: 7 },
  'analytics-dashboard-api': { shares: 'analytics-dashboard' },
  'shop-staging': { flavor: 'M', instances: 2, status: 'Up', night: 2, months: 7 },
  'billing-recette': { flavor: 'S', instances: 1, status: 'Up', night: 15, months: 5 },
  'docs-preview': { flavor: 'XS', instances: 1, status: 'Down', night: 20, months: 13 },
  'partner-portal-demo': { flavor: 'M', instances: 2, status: 'Down', night: 14, months: 13 },
  'mobile-api-dev': { flavor: 'XS', instances: 2, status: 'WaitingForUp', night: 13, months: 4 },
  'crm-sandbox': { flavor: 'S', instances: 2, status: 'WaitingForShutdown', night: 15, months: 12 },
  'intranet-dev': { flavor: 'XS', instances: 1, status: 'Error', night: 12, months: 3 },
  'legacy-backoffice': { flavor: 'L', instances: 1, status: 'Down', night: 18, months: 2 },
  'ml-notebooks': { flavor: 'XS', instances: 1, status: 'WaitingForInit', night: 0, months: 0 },
  'summer-campaign': { disabled: true },
  'auth-service': { none: 'auth.internal.acme.example:443' },
  'public-website': { none: 'www-origin.acme.example:443' },
};

const LABELS = { Up: 'Up', Down: 'Asleep', WaitingForUp: 'Waking up', WaitingForShutdown: 'Going to sleep', WaitingForInit: 'Initializing', Error: 'Error' };
const apps = Object.fromEntries(demoApps().map((a) => [a.slug, a]));

// a sleep every weekday night, the whole weekend, a few days off here and there
function days(spec, count) {
  const hourly = PRICES[spec.flavor] * spec.instances;
  const out = [];
  for (let n = count - 1; n >= 0; n--) {
    const ts = now - n * DAY;
    const weekend = [0, 6].includes(new Date(ts).getDay());
    const jitter = ((n * 7919) % 13) / 10 - 0.6;
    const hours = spec.months * 30 < n ? 0 : weekend ? 24 : Math.max(0, spec.night + jitter);
    out.push({ date: date(ts), saved: round(hours * hourly) });
  }
  return out;
}

function savingsOf(slug) {
  const spec = DEMO[slug];
  const app = apps[slug];
  const hourly = PRICES[spec.flavor] * spec.instances;
  const all = days(spec, 400);
  const sum = (list) => round(list.reduce((acc, d) => acc + d.saved, 0));
  const today = date(now);
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const asleep = spec.status === 'Down';
  return {
    enabled: true,
    app_id: app.id,
    currency: 'EUR',
    cost: {
      app_id: app.id, zone: 'par', currency: 'EUR',
      min_flavor: spec.flavor, min_price_id: `apps.${spec.flavor}`, max_flavor: spec.flavor, max_price_id: `apps.${spec.flavor}`,
      min_instances: spec.instances, max_instances: spec.instances,
      hourly_min: round(hourly, 6), hourly_max: round(hourly, 6), refreshed_at: now - 2 * HOUR,
    },
    total: sum(all),
    slept_hours: round(all.reduce((acc, d) => acc + d.saved, 0) / hourly, 1),
    sleeps: Math.round(spec.months * 30 * 0.9),
    current: asleep ? { since: now - 14.3 * HOUR, saved: round(14.3 * hourly) } : null,
    last_sleep: { from: now - 2 * DAY, to: now - 2 * DAY + 13.8 * HOUR, hours: 13.8, hourly: round(hourly), saved: round(13.8 * hourly) },
    today: sum(all.filter((d) => d.date === today)),
    this_month: sum(all.filter((d) => d.date.startsWith(month))),
    this_year: sum(all.filter((d) => d.date.startsWith(year))),
    last_30_days: all.slice(-30),
    _days: all,
  };
}

const reaped = Object.keys(DEMO).filter((slug) => DEMO[slug].flavor);
const perApp = Object.fromEntries(reaped.map((slug) => [slug, savingsOf(slug)]));

function globalSavings() {
  const byDay = {};
  Object.values(perApp).forEach((s) => s._days.forEach((d) => (byDay[d.date] = (byDay[d.date] || 0) + d.saved)));
  const list = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b));
  const today = date(now);
  const sum = (keep) => round(list.filter(([d]) => keep(d)).reduce((acc, [, v]) => acc + v, 0));
  const asleep = reaped.filter((slug) => DEMO[slug].status === 'Down');
  return {
    enabled: true,
    currency: 'EUR',
    total: sum(() => true),
    asleep: asleep.length,
    saving_per_hour: round(asleep.reduce((acc, slug) => acc + PRICES[DEMO[slug].flavor] * DEMO[slug].instances, 0)),
    apps_with_cost: reaped.length,
    today: sum((d) => d === today),
    this_month: sum((d) => d.startsWith(today.slice(0, 7))),
    this_year: sum((d) => d.startsWith(today.slice(0, 4))),
    last_30_days: list.slice(-30).map(([d, v]) => ({ date: d, saved: round(v) })),
  };
}

function row(slug) {
  const spec = DEMO[slug];
  const owner = (DEMO[slug].shares ? apps[spec.shares] : apps[slug])?.owner;
  if (spec.none) {
    return {
      id: `route_reaper_demo_${slug}`, name: slug, enabled: true, domains: [`${slug}.acme.oto.tools`], targets: [`https://${spec.none}`],
      reaper: { installed: false, enabled: false, config: null, app_id: null, detected: false }, state: null,
      frontend: `${slug}.acme.oto.tools`, backend: spec.none, app: '', reaper_status: 'disabled', status_label: '', last_access_at: 0, reap_at: 0, saved: 0,
    };
  }
  const target = spec.shares || slug;
  const app = apps[target];
  const main = DEMO[target];
  const enabled = !spec.disabled;
  const status = main.status;
  const lastAccess = status === 'Up' ? now - (slug === 'shop-staging' ? 8000 : 17 * 60000) : now - 14.4 * HOUR;
  return {
    id: `route_reaper_demo_${slug}`, name: slug, enabled: true,
    domains: [`${slug}.acme.oto.tools`], targets: [`http://${target}-app.oto.tools:9991`],
    reaper: {
      installed: true, enabled,
      config: { app_id: app.id, owner_id: null, grace_period: 1800, fail_timeout: 900, allow_waiting_page: true, api_behavior: 'hold', ready_delay: 3, must_be_up_at: [], timezone: null, monitoring_filters: [], waiting_page: null },
      app_id: app.id, detected: false,
    },
    state: enabled && status ? {
      app_id: app.id, status, owner_id: owner, name: app.name,
      clever_state: status === 'Up' ? 'SHOULD_BE_UP' : status === 'Down' ? 'SHOULD_BE_DOWN' : 'WANTS_TO_BE_UP',
      cause: status === 'Down' ? 'the app is stopped' : status === 'Error' ? 'the app failed to start on clever cloud' : 'the app is up',
      error_cause: status === 'Error' ? 'the app failed to start on clever cloud' : null,
      last_status_update: now - 14.3 * HOUR, last_access: lastAccess,
      reap_at: status === 'Up' ? lastAccess + 30 * 60000 : null,
      routes: [`route_reaper_demo_${slug}`], grace_period: 1800000, fail_timeout: 900000,
    } : null,
    frontend: `${slug}.acme.oto.tools`, backend: `${target}-app.oto.tools:9991`, app: app.name,
    reaper_status: enabled ? 'enabled' : 'disabled', status_label: enabled ? LABELS[status] || 'Pending' : '',
    last_access_at: enabled ? lastAccess : 0,
    reap_at: enabled && status === 'Up' ? lastAccess + 30 * 60000 : 0,
    saved: enabled && perApp[target] ? perApp[target].total : 0,
  };
}

const rows = Object.keys(DEMO).map(row).sort((a, b) => a.name.localeCompare(b.name));
const statuses = Object.fromEntries(Object.keys(LABELS).map((s) => [s, reaped.filter((slug) => DEMO[slug].status === s).length]));
const overview = {
  token_configured: true, api_url: 'https://api-bridge.clever-cloud.com', dry_run: false,
  settings: { kill_switch: false, updated_at: null, updated_by: null },
  cluster_mode: 'Leader', timezone: 'Europe/Paris', interval: 30000, fast_interval: 5000,
  last_tick: { at: now - 4000, full: true, apps: reaped.length }, apps: reaped.length, by_status: statuses,
};

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function mock(page) {
  await page.route((url) => url.pathname.startsWith(API + '/'), (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice(API.length);
    if (path === '/overview') return route.fulfill(json(overview));
    if (path === '/savings') return route.fulfill(json(globalSavings()));
    if (path === '/routes') return route.fulfill(json({ total: rows.length, page: 1, page_size: 15, pages: 1, items: rows }));
    if (path === '/clever/apps') {
      return route.fulfill(json(Object.values(apps).map((a) => ({ id: a.id, name: a.name, owner_id: a.owner, label: `${a.name} (Acme) - ${a.id}`, vhosts: [] }))));
    }
    let m = path.match(/^\/routes\/([^/]+)$/);
    if (m) return route.fulfill(json({ ...rows.find((r) => r.id === m[1]), siblings: [] }));
    m = path.match(/^\/apps\/([^/]+)\/savings$/);
    if (m) {
      const slug = Object.keys(perApp).find((s) => apps[s].id === m[1]);
      const { _days, ...savings } = perApp[slug];
      return route.fulfill(json(savings));
    }
    if (/^\/apps\/[^/]+\/history$/.test(path)) return route.fulfill(json([]));
    return route.continue();
  });
}

async function login(page) {
  await page.goto(`${BASE}/bo/simple/login`, { waitUntil: 'networkidle' });
  if (!page.url().includes('/login')) return;
  await page.fill('input[name="email"]', USER);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), page.click('button[type="submit"]')]);
}

const run = async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1568, height: 950 }, colorScheme: THEME });
  await context.addInitScript((theme) => {
    try {
      window.localStorage.setItem('otoroshi-dark-light-mode', theme);
    } catch (e) {}
  }, THEME);
  const page = await context.newPage();
  console.log(`→ ${BASE} as ${USER} (${THEME} theme), with demo savings`);
  await login(page);
  await mock(page);

  // the routes, with what each app saved, and the totals above them
  await page.goto(CONSOLE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(OUT, 'reaper-savings.png') });
  console.log('  ✓ reaper-savings.png');

  // the savings of an app asleep right now
  await page.goto(`${CONSOLE}/edit/route_reaper_demo_partner-portal-demo`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.addStyleTag({ content: '.displayGroupBtn { display: none !important; }' });
  // a window as tall as the page: the backoffice scrolls its content in a container
  const height = await page.evaluate(() => {
    const c = document.getElementById('content-scroll-container');
    return c ? Math.ceil(c.getBoundingClientRect().top + c.scrollHeight) : document.documentElement.scrollHeight;
  });
  await page.setViewportSize({ width: 1568, height: Math.max(950, height) });
  await page.waitForTimeout(600);
  const clip = await page.evaluate(() => {
    const titles = [...document.querySelectorAll('form .col-sm-10 span')].filter((e) => e.children.length === 0);
    const title = (text) => titles.find((e) => e.textContent.trim() === text);
    const start = title('Savings').closest('.row');
    const end = title('Clever Cloud app').closest('.row');
    const box = start.closest('form').getBoundingClientRect();
    const top = start.getBoundingClientRect().top - 8;
    return { x: Math.max(0, box.left - 16), y: Math.max(0, top), width: box.width + 32, height: end.getBoundingClientRect().top - 8 - top };
  });
  await page.screenshot({ path: resolve(OUT, 'reaper-route-savings.png'), clip });
  console.log('  ✓ reaper-route-savings.png');

  await browser.close();
  console.log(`\nDone. Wrote to ${OUT}`);
  process.exit(0);
};

run().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
