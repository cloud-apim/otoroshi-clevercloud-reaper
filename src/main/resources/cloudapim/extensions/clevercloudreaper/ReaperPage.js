// Clever Cloud Reaper — the routes, and which of them put their app to sleep.
// Injected inside the extension closure: React, Component and BASE come from there.

function reaperEnsureStyles() {
  if (document.getElementById('clevercloud-reaper-styles')) return;
  const style = document.createElement('style');
  style.id = 'clevercloud-reaper-styles';
  style.textContent = [
    '.reaper-panel { background: var(--bg-color_level2); color: var(--color_level2);',
    '  border: 1px solid var(--border-color); border-radius: 4px; padding: 12px 16px; margin-bottom: 12px; }',
    '.reaper-notice { background: var(--bg-color_level3); color: var(--color_level2); border: 1px solid var(--border-color);',
    '  border-left: 3px solid var(--reaper-accent); border-radius: 3px; padding: 8px 12px; margin-bottom: 8px; }',
    '.reaper-badge { display: inline-block; border: 1px solid var(--reaper-accent); color: var(--reaper-accent);',
    '  border-radius: 3px; padding: 1px 7px; margin-right: 6px; font-size: 11px; white-space: nowrap; }',
    '.reaper-btn { font: inherit; font-size: 12px; line-height: 1.5; padding: 2px 10px; margin-right: 4px; border-radius: 3px;',
    '  border: 1px solid var(--reaper-accent); color: var(--reaper-accent); background: transparent; cursor: pointer; white-space: nowrap; }',
    '.reaper-btn:hover:not(:disabled) { background: var(--reaper-accent); color: var(--bg-color_level2); }',
    '.reaper-btn:disabled { opacity: 0.35; cursor: not-allowed; }',
    '.reaper-meta { opacity: 0.65; font-size: 12px; overflow-wrap: anywhere; }',
    // the look of otoroshi's own tables (react-table): one line per row, uppercase muted headers
    '.reaper-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 0.875rem; }',
    '.reaper-table th { color: var(--text-muted); font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;',
    '  text-align: left; white-space: nowrap; padding: 8px 12px; border-bottom: 1px solid var(--border-color); }',
    '.reaper-table td { height: 44px; padding: 0 12px; border-bottom: 1px solid var(--border-color); vertical-align: middle;',
    '  color: var(--color_level1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.reaper-table tbody tr:hover > td { background: var(--hover-bg); }',
    '.reaper-table tr.reaper-expanded > td { background: var(--bg-color_level3); }',
    '.reaper-table tr.reaper-panel-row > td { height: auto; padding: 16px 12px; white-space: normal; overflow: visible; }',
    '.reaper-table .reaper-sub { color: var(--text-muted); margin-left: 8px; font-size: 0.8125rem; }',
    '.reaper-pager { position: relative; }',
    '.reaper-pager .reaper-page-size { position: absolute; left: 0; top: 0; bottom: 0; display: flex; align-items: center; gap: 8px; }',
    '.reaper-pager .reaper-page-size select { width: auto; color: var(--color_level1); background: var(--bg-color_level2);',
    '  border: 1px solid var(--input-border); border-radius: 6px; padding: 2px 6px; }',
    '.reaper-pager .-pageJump input { width: 60px; text-align: center; }',
    '.reaper-filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }',
    '.reaper-filters input, .reaper-filters select { max-width: 280px; }',
    '.reaper-form { display: grid; grid-template-columns: 220px 1fr; gap: 8px 16px; align-items: center; max-width: 900px; }',
    '.reaper-form label { margin: 0; opacity: 0.8; }',
    '.reaper-form .reaper-help { grid-column: 2; margin-top: -6px; }',
    '.reaper-list-row { display: flex; gap: 6px; margin-bottom: 6px; align-items: center; }',
    '.reaper-switch { cursor: pointer; font-size: 20px; }',
    '.reaper-neutral { --reaper-accent: var(--border-color-strong); }',
    '.reaper-info { --reaper-accent: var(--color-blue); }',
    '.reaper-success { --reaper-accent: var(--color-green); }',
    '.reaper-warning { --reaper-accent: var(--color-primary); }',
    '.reaper-danger { --reaper-accent: var(--color-red); }',
    '[data-theme="light"] .reaper-warning { --reaper-accent: #8a5d00; }',
    '[data-theme="light"] .reaper-success { --reaper-accent: #2c7048; }',
    '[data-theme="light"] .reaper-info { --reaper-accent: #0b6b79; }',
  ].join('\n');
  document.head.appendChild(style);
}

function reaperCall(method, path, body) {
  return fetch(BASE + path, {
    method: method,
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => r.json().catch(() => ({})).then((json) => ({ status: r.status, json: json })));
}

const REAPER_TONES = {
  Up: 'success',
  Down: 'info',
  WaitingForUp: 'warning',
  WaitingForShutdown: 'warning',
  WaitingForInit: 'neutral',
  Error: 'danger',
};

const REAPER_LABELS = {
  Up: 'Up',
  Down: 'Asleep',
  WaitingForUp: 'Waking up',
  WaitingForShutdown: 'Going to sleep',
  WaitingForInit: 'Initializing',
  Error: 'Error',
};

const REAPER_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function reaperBadge(key, label, tone, title) {
  return React.createElement('span', { key: key, className: 'reaper-badge reaper-' + (tone || 'neutral'), title: title }, label);
}

function reaperDuration(ms) {
  const abs = Math.abs(ms);
  if (abs < 60000) return Math.round(abs / 1000) + 's';
  if (abs < 3600000) return Math.round(abs / 60000) + 'm';
  if (abs < 48 * 3600000) {
    const h = Math.floor(abs / 3600000);
    const m = Math.round((abs % 3600000) / 60000);
    return h + 'h' + (m > 0 ? String(m).padStart(2, '0') : '');
  }
  return Math.round(abs / 86400000) + 'd';
}

function reaperAgo(ts) {
  if (!ts) return '-';
  return reaperDuration(Date.now() - ts) + ' ago';
}

function reaperDate(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString();
}

class CleverCloudReaperConfigEditor extends Component {
  constructor(props) {
    super(props);
    const c = props.config || {};
    this.state = {
      app_id: c.app_id || props.appId || '',
      owner_id: c.owner_id || '',
      grace_minutes: Math.round((c.grace_period || 3600) / 60),
      fail_minutes: Math.round((c.fail_timeout || 900) / 60),
      ready_delay: c.ready_delay === undefined ? 3 : c.ready_delay,
      allow_waiting_page: c.allow_waiting_page === undefined ? true : !!c.allow_waiting_page,
      api_behavior: c.api_behavior || 'hold',
      timezone: c.timezone || '',
      must_be_up_at: (c.must_be_up_at || []).map((r) => ({ days: (r.days || []).join(', '), start: r.start || '08:00', end: r.end || '19:00' })),
      monitoring_filters: (c.monitoring_filters || []).map((f) => ({ source: f.source || 'path', name: f.name || '', regex: f.regex || '' })),
    };
  }

  config = () => ({
    app_id: this.state.app_id || null,
    owner_id: this.state.owner_id || null,
    grace_period: Math.max(1, Number(this.state.grace_minutes) || 60) * 60,
    fail_timeout: Math.max(1, Number(this.state.fail_minutes) || 15) * 60,
    ready_delay: Math.max(0, Number(this.state.ready_delay) || 0),
    allow_waiting_page: this.state.allow_waiting_page,
    api_behavior: this.state.api_behavior,
    timezone: this.state.timezone || null,
    must_be_up_at: this.state.must_be_up_at.map((r) => ({
      days: r.days.split(',').map((d) => d.trim().toLowerCase()).filter((d) => d.length > 0),
      start: r.start,
      end: r.end,
    })),
    monitoring_filters: this.state.monitoring_filters
      .filter((f) => f.regex.trim().length > 0)
      .map((f) => ({ source: f.source, name: f.name || null, regex: f.regex })),
  });

  updateItem = (list, index, field, value) => {
    const items = this.state[list].slice();
    items[index] = Object.assign({}, items[index], { [field]: value });
    this.setState({ [list]: items });
  };

  removeItem = (list, index) => {
    const items = this.state[list].slice();
    items.splice(index, 1);
    this.setState({ [list]: items });
  };

  input(field, type, extra) {
    return React.createElement('input', Object.assign({
      type: type || 'text',
      className: 'form-control',
      value: this.state[field],
      onChange: (e) => this.setState({ [field]: type === 'checkbox' ? e.target.checked : e.target.value }),
    }, extra || {}));
  }

  render() {
    const h = React.createElement;
    const apps = this.props.cleverApps || [];
    const known = apps.find((a) => a.id === this.state.app_id);
    return h('div', null,
      h('div', { className: 'reaper-form' },
        h('label', null, 'Clever Cloud app'),
        h('div', { style: { display: 'flex', gap: 6 } },
          h('select', {
            className: 'form-control',
            value: known ? this.state.app_id : '',
            onChange: (e) => {
              const app = apps.find((a) => a.id === e.target.value);
              this.setState({ app_id: e.target.value, owner_id: app ? app.owner_id : this.state.owner_id });
            },
          },
            h('option', { value: '' }, apps.length ? '-- choose an app --' : '-- no app listed, type its id --'),
            apps.map((a) => h('option', { key: a.id, value: a.id }, a.label))
          ),
          this.input('app_id', 'text', { placeholder: 'app_xxx', style: { maxWidth: 360 } })
        ),
        h('label', null, 'Owner'),
        this.input('owner_id', 'text', { placeholder: 'orga_xxx (discovered when empty)' }),
        h('label', null, 'Grace period (minutes)'),
        this.input('grace_minutes', 'number', { min: 1 }),
        h('span', { className: 'reaper-meta reaper-help' }, 'How long the app may go without traffic before it is put to sleep'),
        h('label', null, 'Fail timeout (minutes)'),
        this.input('fail_minutes', 'number', { min: 1 }),
        h('span', { className: 'reaper-meta reaper-help' }, 'How long a start or a stop may take before the app goes into error'),
        h('label', null, 'Ready delay (seconds)'),
        this.input('ready_delay', 'number', { min: 0 }),
        h('label', null, 'Waiting page for browsers'),
        h('div', null, h('input', {
          type: 'checkbox',
          checked: this.state.allow_waiting_page,
          onChange: (e) => this.setState({ allow_waiting_page: e.target.checked }),
        })),
        h('label', null, 'Other requests while waking up'),
        h('select', { className: 'form-control', value: this.state.api_behavior, onChange: (e) => this.setState({ api_behavior: e.target.value }) },
          h('option', { value: 'hold' }, 'Held until the app is up'),
          h('option', { value: 'unavailable' }, '503 with a Retry-After header'),
          h('option', { value: 'client_poll' }, 'A small html page that polls the path and reloads once the app answers')
        ),
        h('label', null, 'Timezone'),
        this.input('timezone', 'text', { placeholder: 'default of the extension (' + (this.props.defaultTimezone || 'Europe/Paris') + ')' }),
        h('label', null, 'Must be up at'),
        h('div', null,
          this.state.must_be_up_at.map((r, i) => h('div', { key: 'r' + i, className: 'reaper-list-row' },
            h('input', { className: 'form-control', placeholder: 'days: monday, friday (empty: every day)', value: r.days, onChange: (e) => this.updateItem('must_be_up_at', i, 'days', e.target.value) }),
            h('input', { className: 'form-control', type: 'time', style: { maxWidth: 130 }, value: r.start, onChange: (e) => this.updateItem('must_be_up_at', i, 'start', e.target.value) }),
            h('input', { className: 'form-control', type: 'time', style: { maxWidth: 130 }, value: r.end, onChange: (e) => this.updateItem('must_be_up_at', i, 'end', e.target.value) }),
            h('button', { type: 'button', className: 'reaper-btn reaper-danger', onClick: () => this.removeItem('must_be_up_at', i) }, h('i', { className: 'fas fa-trash' }))
          )),
          h('button', {
            type: 'button',
            className: 'reaper-btn reaper-neutral',
            onClick: () => this.setState({ must_be_up_at: this.state.must_be_up_at.concat([{ days: REAPER_DAYS.slice(0, 5).join(', '), start: '08:00', end: '19:00' }]) }),
          }, h('i', { className: 'fas fa-plus' }), ' add a time range')
        ),
        h('label', null, 'Monitoring filters'),
        h('div', null,
          this.state.monitoring_filters.map((f, i) => h('div', { key: 'f' + i, className: 'reaper-list-row' },
            h('select', { className: 'form-control', style: { maxWidth: 150 }, value: f.source, onChange: (e) => this.updateItem('monitoring_filters', i, 'source', e.target.value) },
              h('option', { value: 'path' }, 'Path'),
              h('option', { value: 'uri' }, 'Path and query'),
              h('option', { value: 'header' }, 'Header'),
              h('option', { value: 'user_agent' }, 'User-Agent'),
              h('option', { value: 'query' }, 'Query param')
            ),
            (f.source === 'header' || f.source === 'query')
              ? h('input', { className: 'form-control', style: { maxWidth: 180 }, placeholder: 'name', value: f.name, onChange: (e) => this.updateItem('monitoring_filters', i, 'name', e.target.value) })
              : null,
            h('input', { className: 'form-control', placeholder: 'regex, e.g. ^/health$', value: f.regex, onChange: (e) => this.updateItem('monitoring_filters', i, 'regex', e.target.value) }),
            h('button', { type: 'button', className: 'reaper-btn reaper-danger', onClick: () => this.removeItem('monitoring_filters', i) }, h('i', { className: 'fas fa-trash' }))
          )),
          h('button', {
            type: 'button',
            className: 'reaper-btn reaper-neutral',
            onClick: () => this.setState({ monitoring_filters: this.state.monitoring_filters.concat([{ source: 'user_agent', name: '', regex: '(?i)statuscake' }]) }),
          }, h('i', { className: 'fas fa-plus' }), ' add a filter')
        ),
        h('span', { className: 'reaper-meta reaper-help' }, 'Matching requests are not traffic: they neither keep the app awake nor wake it up. One match is enough.')
      ),
      h('div', { style: { marginTop: 12 } },
        h('button', { type: 'button', className: 'reaper-btn reaper-success', disabled: this.props.saving, onClick: () => this.props.onSave(this.config()) },
          h('i', { className: 'fas fa-save' }), ' ', this.props.saveLabel || 'Save'),
        h('button', { type: 'button', className: 'reaper-btn reaper-neutral', onClick: this.props.onCancel }, 'Cancel'),
        h('a', { className: 'reaper-meta', style: { marginLeft: 8 }, href: '/bo/dashboard/routes/' + this.props.routeId + '?tab=flow' },
          'custom waiting page and include/exclude paths in the route designer')
      )
    );
  }
}

class CleverCloudReaperHistory extends Component {
  state = { items: null, error: null };

  componentDidMount() {
    reaperCall('GET', '/apps/' + this.props.appId + '/history?page_size=15').then(({ status, json }) => {
      if (status >= 400) this.setState({ error: json.error || 'could not load the history' });
      else this.setState({ items: json });
    });
  }

  render() {
    const h = React.createElement;
    if (this.state.error) return h('div', { className: 'reaper-meta' }, this.state.error);
    if (!this.state.items) return h('div', { className: 'reaper-meta' }, 'loading the history...');
    if (this.state.items.length === 0) return h('div', { className: 'reaper-meta' }, 'no transition yet');
    return h('table', { className: 'reaper-table' },
      h('thead', null, h('tr', null, h('th', null, 'When'), h('th', null, 'From'), h('th', null, 'To'), h('th', null, 'Cause'))),
      h('tbody', null, this.state.items.map((t, i) => h('tr', { key: i },
        h('td', null, reaperDate(t.at)),
        h('td', null, reaperBadge('f', REAPER_LABELS[t.from] || t.from, REAPER_TONES[t.from])),
        h('td', null, reaperBadge('t', REAPER_LABELS[t.to] || t.to, REAPER_TONES[t.to])),
        h('td', null, t.cause)
      )))
    );
  }
}

const REAPER_PAGE_SIZES = [5, 15, 20, 50, 100];

const REAPER_COLUMNS = [
  { title: 'Name', width: '15%' },
  { title: 'Frontend', width: '17%' },
  { title: 'Backend', width: '15%' },
  { title: 'Clever Cloud app', width: '15%' },
  { title: 'Reaper', width: '70px' },
  { title: 'Status', width: '130px' },
  { title: 'Last access', width: '100px' },
  { title: 'Goes to sleep', width: '110px' },
  { title: '', width: '130px' },
];

// remembered per viewer, like a filter: nothing breaks when the storage is not there
function reaperStoredPageSize() {
  try {
    const value = parseInt(window.localStorage.getItem('clevercloud-reaper-page-size'), 10);
    return REAPER_PAGE_SIZES.indexOf(value) > -1 ? value : 15;
  } catch (e) {
    return 15;
  }
}

function reaperStorePageSize(value) {
  try {
    window.localStorage.setItem('clevercloud-reaper-page-size', String(value));
  } catch (e) {}
}

class CleverCloudReaperPage extends Component {
  state = {
    overview: null,
    rows: [],
    total: 0,
    page: 1,
    pageSize: reaperStoredPageSize(),
    search: '',
    reaper: 'all',
    status: '',
    loading: true,
    error: null,
    message: null,
    expanded: null,
    panel: null,
    busy: {},
    cleverApps: null,
  };

  componentDidMount() {
    reaperEnsureStyles();
    if (this.props.setTitle) this.props.setTitle('Clever Cloud Reaper');
    this.refresh();
    // the states move on their own: follow them without reloading the page
    this.timer = setInterval(() => this.refresh(true), 5000);
  }

  componentWillUnmount() {
    clearInterval(this.timer);
    clearTimeout(this.searchTimer);
  }

  refresh = (silent) => {
    if (!silent) this.setState({ loading: true });
    const params = new URLSearchParams({
      search: this.state.search,
      reaper: this.state.reaper,
      status: this.state.status,
      page: String(this.state.page),
      page_size: String(this.state.pageSize),
    });
    return Promise.all([reaperCall('GET', '/overview'), reaperCall('GET', '/routes?' + params.toString())])
      .then(([overview, routes]) => {
        if (routes.status >= 400) this.setState({ error: routes.json.error || 'could not load the routes', loading: false });
        else this.setState({ overview: overview.json, rows: routes.json.items || [], total: routes.json.total || 0, loading: false, error: null });
      })
      .catch((e) => this.setState({ error: String(e.message || e), loading: false }));
  };

  loadCleverApps = (force) => {
    if (this.state.cleverApps && !force) return;
    reaperCall('GET', '/clever/apps' + (force ? '?force=true' : '')).then(({ status, json }) => {
      this.setState({ cleverApps: status >= 400 || !Array.isArray(json) ? [] : json });
    });
  };

  setFilter = (field, value) => {
    this.setState({ [field]: value, page: 1 }, () => {
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => this.refresh(), field === 'search' ? 300 : 0);
    });
  };

  withBusy = (key, promise) => {
    this.setState({ busy: Object.assign({}, this.state.busy, { [key]: true }) });
    return promise.then((res) => {
      const busy = Object.assign({}, this.state.busy);
      delete busy[key];
      this.setState({ busy: busy });
      return res;
    });
  };

  report = ({ status, json }, success) => {
    if (status >= 400) this.setState({ message: { tone: 'danger', text: json.error || 'something went wrong' } });
    else this.setState({ message: json.warning ? { tone: 'warning', text: json.warning } : { tone: 'success', text: success } });
    return status < 400;
  };

  toggle = (row) => {
    if (row.reaper.enabled) {
      if (!window.confirm('Stop managing the app of "' + row.name + '"? It is started again if it sleeps.')) return;
      this.withBusy(row.id, reaperCall('POST', '/routes/' + row.id + '/_disable')).then((res) => {
        this.report(res, 'The reaper is disabled on "' + row.name + '"');
        this.refresh(true);
      });
    } else if (!row.reaper.app_id) {
      // nothing to guess the app from: the user picks it, then it is enabled with that config
      this.openPanel(row, 'enable');
    } else {
      this.withBusy(row.id, reaperCall('POST', '/routes/' + row.id + '/_enable', row.reaper.config ? {} : { app_id: row.reaper.app_id }))
        .then((res) => {
          if (!this.report(res, 'The reaper is enabled on "' + row.name + '". The change reaches the gateway within a few seconds.')) {
            this.openPanel(row, 'enable');
          }
          this.refresh(true);
        });
    }
  };

  openPanel = (row, panel) => {
    if (panel === 'config' || panel === 'enable') this.loadCleverApps();
    if (this.state.expanded === row.id && this.state.panel === panel) this.setState({ expanded: null, panel: null });
    else this.setState({ expanded: row.id, panel: panel });
  };

  saveConfig = (row, config) => {
    const enabling = this.state.panel === 'enable';
    const call = enabling ? reaperCall('POST', '/routes/' + row.id + '/_enable', config) : reaperCall('PUT', '/routes/' + row.id + '/config', config);
    this.withBusy(row.id, call).then((res) => {
      if (this.report(res, enabling ? 'The reaper is enabled on "' + row.name + '"' : 'Settings of "' + row.name + '" saved')) {
        this.setState({ expanded: null, panel: null });
      }
      this.refresh(true);
    });
  };

  appAction = (row, action, label, confirm) => {
    const appId = row.reaper.app_id;
    if (confirm && !window.confirm(confirm)) return;
    this.withBusy(row.id, reaperCall('POST', '/apps/' + appId + '/' + action)).then((res) => {
      this.report(res, label);
      this.refresh(true);
    });
  };

  toggleKillSwitch = () => {
    const current = this.state.overview && this.state.overview.settings && this.state.overview.settings.kill_switch;
    const text = current ? 'Turn the kill switch off? Apps without traffic are put to sleep again.' : 'Turn the kill switch on? No app is put to sleep until it is off again; wake ups keep working.';
    if (!window.confirm(text)) return;
    reaperCall('PUT', '/settings', { kill_switch: !current }).then((res) => {
      this.report(res, 'Kill switch ' + (!current ? 'on' : 'off'));
      this.refresh(true);
    });
  };

  renderNotices() {
    const h = React.createElement;
    const o = this.state.overview;
    const notices = [];
    if (this.state.message) {
      notices.push(h('div', { key: 'msg', className: 'reaper-notice reaper-' + this.state.message.tone, style: { display: 'flex', justifyContent: 'space-between' } },
        h('span', null, this.state.message.text),
        h('a', { href: '#', onClick: (e) => { e.preventDefault(); this.setState({ message: null }); } }, h('i', { className: 'fas fa-times' }))
      ));
    }
    if (this.state.error) notices.push(h('div', { key: 'err', className: 'reaper-notice reaper-danger' }, this.state.error));
    if (!o) return notices;
    if (!o.token_configured) {
      notices.push(h('div', { key: 'token', className: 'reaper-notice reaper-danger' },
        'No Clever Cloud API token is configured: set CLEVER_CLOUD_API_TOKEN and restart Otoroshi. Until then, the reaper does nothing.'));
    }
    if (o.dry_run) notices.push(h('div', { key: 'dry', className: 'reaper-notice reaper-warning' }, 'Dry-run mode: the reaper says what it would put to sleep, in the logs, but never stops an app.'));
    if (o.settings && o.settings.kill_switch) {
      notices.push(h('div', { key: 'kill', className: 'reaper-notice reaper-warning' },
        'The kill switch is on' + (o.settings.updated_by ? ' (' + o.settings.updated_by + ', ' + reaperAgo(o.settings.updated_at) + ')' : '') + ': no app is put to sleep. Wake ups keep working.'));
    }
    // without a token every run fails the same way: the notice above already says it
    if (o.token_configured && o.last_tick && o.last_tick.error) {
      notices.push(h('div', { key: 'tick', className: 'reaper-notice reaper-danger' }, 'Last run of the reaper failed: ' + o.last_tick.error));
    }
    return notices;
  }

  renderOverview() {
    const h = React.createElement;
    const o = this.state.overview;
    if (!o) return null;
    const by = o.by_status || {};
    return h('div', { className: 'reaper-panel', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 } },
      h('div', null,
        Object.keys(REAPER_LABELS).filter((s) => by[s] > 0).map((s) => reaperBadge(s, by[s] + ' ' + REAPER_LABELS[s].toLowerCase(), REAPER_TONES[s])),
        o.apps === 0 ? h('span', { className: 'reaper-meta' }, 'No app managed yet: enable the reaper on a route below.') : null
      ),
      h('div', null,
        h('span', { className: 'reaper-meta', style: { marginRight: 12 } },
          'cluster: ' + o.cluster_mode + ' · timezone: ' + o.timezone + ' · last run: ' + (o.last_tick && o.last_tick.at ? reaperAgo(o.last_tick.at) : 'not on this node')),
        h('button', {
          type: 'button',
          className: 'reaper-btn ' + (o.settings && o.settings.kill_switch ? 'reaper-warning' : 'reaper-neutral'),
          onClick: this.toggleKillSwitch,
        }, h('i', { className: 'fas fa-power-off' }), o.settings && o.settings.kill_switch ? ' Kill switch is on' : ' Kill switch')
      )
    );
  }

  renderFilters() {
    const h = React.createElement;
    return h('div', { className: 'reaper-filters' },
      h('input', {
        type: 'text',
        className: 'form-control',
        placeholder: 'Search a route, domain, target or app',
        value: this.state.search,
        onChange: (e) => this.setFilter('search', e.target.value),
      }),
      h('select', { className: 'form-control', value: this.state.reaper, onChange: (e) => this.setFilter('reaper', e.target.value) },
        h('option', { value: 'all' }, 'All routes'),
        h('option', { value: 'enabled' }, 'Reaper enabled'),
        h('option', { value: 'disabled' }, 'Reaper disabled')
      ),
      h('select', { className: 'form-control', value: this.state.status, onChange: (e) => this.setFilter('status', e.target.value) },
        h('option', { value: '' }, 'Any status'),
        Object.keys(REAPER_LABELS).map((s) => h('option', { key: s, value: s }, REAPER_LABELS[s]))
      ),
      h('span', { className: 'reaper-meta' }, this.state.total + ' route' + (this.state.total > 1 ? 's' : '')),
      this.state.loading ? h('i', { className: 'fas fa-spinner fa-spin' }) : null
    );
  }

  renderRow(row) {
    const h = React.createElement;
    const state = row.state || {};
    const status = row.reaper.enabled ? state.status : null;
    const busy = !!this.state.busy[row.id];
    const managed = row.reaper.enabled && !!state.status;
    const next = status === 'Up' && state.reap_at ? state.reap_at - Date.now() : null;
    const domains = row.domains || [];
    const targets = (row.targets || []).map((t) => t.replace(/^https?:\/\//, ''));
    const more = (list) => (list.length > 1 ? ' +' + (list.length - 1) : '');
    const cells = [
      h('td', { key: 'name', title: row.name },
        h('a', { href: '/bo/dashboard/routes/' + row.id + '?tab=flow' }, row.name),
        row.enabled ? null : h('span', { className: 'reaper-sub' }, '(disabled)')
      ),
      h('td', { key: 'frontend', title: domains.join('\n') }, (domains[0] || '-') + more(domains)),
      h('td', { key: 'backend', title: targets.join('\n') }, (targets[0] || '-') + more(targets)),
      h('td', { key: 'app', title: row.reaper.app_id || 'no clever cloud app could be guessed from the targets of this route' },
        row.reaper.app_id ? state.name || row.reaper.app_id : h('span', { className: 'reaper-meta' }, '-'),
        row.reaper.app_id && row.reaper.detected && !row.reaper.enabled ? h('span', { className: 'reaper-sub' }, '(guessed)') : null
      ),
      h('td', { key: 'toggle' },
        h('i', {
          className: 'reaper-switch fas ' + (row.reaper.enabled ? 'fa-toggle-on' : 'fa-toggle-off'),
          style: { color: row.reaper.enabled ? 'var(--color-green)' : 'var(--color_level2)', opacity: busy ? 0.4 : 1 },
          title: row.reaper.enabled ? 'disable the reaper on this route' : 'enable the reaper on this route',
          onClick: () => !busy && this.toggle(row),
        })
      ),
      h('td', { key: 'status', title: status === 'Error' ? state.error_cause : state.cause },
        status ? reaperBadge('s', REAPER_LABELS[status] || status, REAPER_TONES[status]) : h('span', { className: 'reaper-meta' }, row.reaper.enabled ? 'pending' : '-'),
        status === 'Error' ? h('i', { className: 'fas fa-circle-exclamation', style: { color: 'var(--color-red)' } }) : null
      ),
      h('td', { key: 'access', title: managed ? reaperDate(state.last_access) : null }, managed ? reaperAgo(state.last_access) : '-'),
      h('td', { key: 'next' }, next === null ? '-' : next <= 0 ? 'any moment' : 'in ' + reaperDuration(next)),
      h('td', { key: 'actions', style: { textOverflow: 'clip' } },
        managed && status === 'Up'
          ? h('button', { type: 'button', className: 'reaper-btn reaper-info', disabled: busy, title: 'put the app to sleep now',
              onClick: () => this.appAction(row, '_reap', 'The app is going to sleep', 'Put the app of "' + row.name + '" to sleep now?') }, h('i', { className: 'fas fa-moon' }))
          : null,
        managed && (status === 'Down' || status === 'WaitingForShutdown')
          ? h('button', { type: 'button', className: 'reaper-btn reaper-success', disabled: busy, title: 'wake the app up',
              onClick: () => this.appAction(row, '_wake', 'The app is waking up') }, h('i', { className: 'fas fa-sun' }))
          : null,
        managed && status === 'Error'
          ? h('button', { type: 'button', className: 'reaper-btn reaper-warning', disabled: busy, title: 'reset the app: the reaper evaluates it again',
              onClick: () => this.appAction(row, '_reset', 'The app is reset', 'Reset the app of "' + row.name + '"?') }, h('i', { className: 'fas fa-rotate-left' }))
          : null,
        row.reaper.installed
          ? h('button', { type: 'button', className: 'reaper-btn reaper-neutral', title: 'settings', onClick: () => this.openPanel(row, 'config') }, h('i', { className: 'fas fa-cog' }))
          : null,
        managed
          ? h('button', { type: 'button', className: 'reaper-btn reaper-neutral', title: 'history', onClick: () => this.openPanel(row, 'history') }, h('i', { className: 'fas fa-clock-rotate-left' }))
          : null
      ),
    ];
    const rows = [h('tr', { key: row.id, className: this.state.expanded === row.id ? 'reaper-expanded' : '' }, cells)];
    if (this.state.expanded === row.id) {
      let content = null;
      if (this.state.panel === 'history') content = h(CleverCloudReaperHistory, { appId: row.reaper.app_id });
      else
        content = h(CleverCloudReaperConfigEditor, {
          key: row.id + this.state.panel,
          routeId: row.id,
          config: row.reaper.config,
          appId: row.reaper.app_id,
          cleverApps: this.state.cleverApps,
          defaultTimezone: this.state.overview && this.state.overview.timezone,
          saving: busy,
          saveLabel: this.state.panel === 'enable' ? 'Enable the reaper' : 'Save',
          onSave: (config) => this.saveConfig(row, config),
          onCancel: () => this.setState({ expanded: null, panel: null }),
        });
      rows.push(h('tr', { key: row.id + '-panel', className: 'reaper-expanded reaper-panel-row' }, h('td', { colSpan: REAPER_COLUMNS.length }, content)));
    }
    return rows;
  }

  goToPage = (page) => {
    const pages = Math.max(1, Math.ceil(this.state.total / this.state.pageSize));
    const target = Math.min(Math.max(1, page), pages);
    if (target !== this.state.page) this.setState({ page: target, expanded: null, panel: null }, () => this.refresh());
  };

  // the markup of otoroshi's own tables, so their stylesheet paints it
  renderPagination() {
    const h = React.createElement;
    const pages = Math.max(1, Math.ceil(this.state.total / this.state.pageSize));
    return h('div', { className: 'ReactTable reaper-pager' },
      h('div', { className: 'pagination-bottom' },
        h('div', { className: '-pagination' },
          h('div', { className: '-previous' },
            h('button', { type: 'button', className: '-btn', disabled: this.state.page <= 1, onClick: () => this.goToPage(this.state.page - 1) }, 'Previous')
          ),
          h('div', { className: '-center' },
            h('span', { className: '-pageInfo' },
              'Page ',
              h('div', { className: '-pageJump', style: { display: 'inline-block' } },
                h('input', {
                  'aria-label': 'jump to page',
                  type: 'number',
                  min: 1,
                  max: pages,
                  value: this.state.page,
                  onChange: (e) => {
                    const value = parseInt(e.target.value, 10);
                    if (!isNaN(value)) this.goToPage(value);
                  },
                })
              ),
              ' of ',
              h('span', { className: '-totalPages' }, pages)
            )
          ),
          h('div', { className: '-next' },
            h('button', { type: 'button', className: '-btn', disabled: this.state.page >= pages, onClick: () => this.goToPage(this.state.page + 1) }, 'Next')
          )
        )
      ),
      h('div', { className: 'reaper-page-size' },
        h('span', null, 'Rows per page'),
        h('select', {
          'aria-label': 'rows per page',
          value: this.state.pageSize,
          onChange: (e) => {
            const pageSize = parseInt(e.target.value, 10);
            reaperStorePageSize(pageSize);
            this.setState({ pageSize: pageSize, page: 1, expanded: null, panel: null }, () => this.refresh());
          },
        }, REAPER_PAGE_SIZES.map((size) => h('option', { key: size, value: size }, size)))
      )
    );
  }

  render() {
    const h = React.createElement;
    return h('div', null,
      this.renderNotices(),
      this.renderOverview(),
      h('div', { className: 'reaper-panel' },
        this.renderFilters(),
        h('table', { className: 'reaper-table' },
          h('colgroup', null, REAPER_COLUMNS.map((c) => h('col', { key: c.title || 'actions', style: { width: c.width } }))),
          h('thead', null, h('tr', null, REAPER_COLUMNS.map((c) => h('th', { key: c.title || 'actions' }, c.title)))),
          h('tbody', null, this.state.rows.map((row) => this.renderRow(row)))
        ),
        !this.state.loading && this.state.rows.length === 0 ? h('div', { className: 'reaper-meta', style: { padding: 12 } }, 'No route matches.') : null,
        this.renderPagination()
      )
    );
  }
}
