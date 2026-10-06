// Clever Cloud Reaper: the routes in an otoroshi table, and a page per route with its status, its
// actions, its settings and its history. Injected inside the extension closure, where React,
// Component, Table, Form, SelectInput, TextInput and BASE are defined.

const REAPER_PATH = '/extensions/cloud-apim/clevercloud-reaper';

function reaperCall(method, path, body) {
  return fetch(BASE + path, {
    method: method,
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => r.json().catch(() => ({})).then((json) => ({ status: r.status, json: json })));
}

const REAPER_LABELS = {
  Up: 'Up',
  Down: 'Asleep',
  WaitingForUp: 'Waking up',
  WaitingForShutdown: 'Going to sleep',
  WaitingForInit: 'Initializing',
  Error: 'Error',
};

const REAPER_BADGES = {
  Up: 'bg-success',
  Down: 'bg-info',
  WaitingForUp: 'bg-warning',
  WaitingForShutdown: 'bg-warning',
  WaitingForInit: 'bg-secondary',
  Error: 'bg-danger',
};

const REAPER_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

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
  return ts ? reaperDuration(Date.now() - ts) + ' ago' : '-';
}

function reaperDate(ts) {
  return ts ? new Date(ts).toLocaleString() : '-';
}

function reaperMoney(amount, currency, digits) {
  const value = Number(amount || 0);
  const d = digits === undefined ? 2 : digits;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'EUR', minimumFractionDigits: d, maximumFractionDigits: d }).format(value);
  } catch (e) {
    return value.toFixed(d) + ' ' + (currency || '');
  }
}

// the savings of the last days, as small bars: no chart library in the backoffice
function ReaperBars(props) {
  const h = React.createElement;
  const days = props.days || [];
  const max = Math.max.apply(null, days.map((d) => Number(d.saved || 0)).concat([0]));
  return h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 3, height: 64, paddingTop: 6 } },
    days.map((d) => {
      const value = Number(d.saved || 0);
      const height = max > 0 ? Math.max(value > 0 ? 3 : 1, Math.round((value / max) * 58)) : 1;
      return h('div', {
        key: d.date,
        title: d.date + ': ' + reaperMoney(value, props.currency),
        style: { width: 12, height: height, borderRadius: 2, background: value > 0 ? 'var(--color-primary, #f9b000)' : 'rgba(128,128,128,0.35)' },
      });
    })
  );
}

function reaperTile(label, value, hint) {
  const h = React.createElement;
  return h('div', {
    key: label,
    style: { border: '1px solid rgba(128,128,128,0.35)', borderRadius: 6, padding: '8px 14px', minWidth: 150 },
  },
    h('div', { style: { fontSize: '0.72rem', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.06em' } }, label),
    h('div', { style: { fontSize: '1.35rem', fontWeight: 600 } }, value),
    hint ? h('div', { style: { fontSize: '0.75rem', opacity: 0.6 } }, hint) : null
  );
}

function reaperNext(state) {
  if (!state || state.status !== 'Up' || !state.reap_at) return '-';
  const left = state.reap_at - Date.now();
  return left <= 0 ? 'any moment' : 'in ' + reaperDuration(left);
}

function reaperStatusBadge(status) {
  if (!status) return React.createElement('span', null, '-');
  return React.createElement('span', { className: 'badge ' + (REAPER_BADGES[status] || 'bg-secondary') }, REAPER_LABELS[status] || status);
}

function reaperNotices(overview) {
  const h = React.createElement;
  if (!overview) return null;
  const notices = [];
  if (!overview.token_configured) {
    notices.push(['danger', 'No Clever Cloud API token is configured: set CLEVER_CLOUD_API_TOKEN and restart Otoroshi. Until then, the reaper does nothing.']);
  }
  if (overview.dry_run) {
    notices.push(['warning', 'Dry-run mode: the reaper says what it would put to sleep, in the logs, but never stops an app.']);
  }
  if (overview.settings && overview.settings.kill_switch) {
    notices.push(['warning', 'The kill switch is on' + (overview.settings.updated_by ? ' (' + overview.settings.updated_by + ', ' + reaperAgo(overview.settings.updated_at) + ')' : '') + ': no app is put to sleep. Wake ups keep working.']);
  }
  if (overview.token_configured && overview.last_tick && overview.last_tick.error) {
    notices.push(['danger', 'The last run of the reaper failed: ' + overview.last_tick.error]);
  }
  return notices.map(([kind, text], i) => h('div', { key: i, className: 'alert alert-' + kind, role: 'alert' }, text));
}

// ---------------------------------------------------------------------------------------------
// the routes
// ---------------------------------------------------------------------------------------------

class CleverCloudReaperRoutesPage extends Component {
  state = { overview: null, savings: null };

  columns = [
    { title: 'Name', filterId: 'name', content: (item) => item.name },
    { title: 'Frontend', filterId: 'frontend', content: (item) => item.frontend },
    { title: 'Backend', filterId: 'backend', content: (item) => item.backend },
    { title: 'Clever Cloud app', filterId: 'app', content: (item) => item.app },
    {
      title: 'Reaper',
      filterId: 'reaper_status',
      style: { textAlign: 'center', width: 90 },
      content: (item) => item.reaper_status,
      wrappedCell: (value) =>
        value === 'enabled'
          ? React.createElement('span', { className: 'fas fa-check-circle', style: { color: 'var(--color-green)' } })
          : React.createElement('span', { className: 'fas fa-times-circle', style: { opacity: 0.4 } }),
    },
    {
      title: 'Status',
      filterId: 'status_label',
      style: { width: 140 },
      content: (item) => item.status_label,
      wrappedCell: (value, item) => (item.reaper.enabled ? reaperStatusBadge(item.state && item.state.status) : '-'),
    },
    {
      title: 'Last access',
      filterId: 'last_access_at',
      notFilterable: true,
      style: { width: 130 },
      content: (item) => item.last_access_at,
      wrappedCell: (value) => (value ? reaperAgo(value) : '-'),
    },
    {
      title: 'Goes to sleep',
      filterId: 'reap_at',
      notFilterable: true,
      style: { width: 130 },
      content: (item) => item.reap_at,
      wrappedCell: (value, item) => reaperNext(item.state),
    },
    {
      title: 'Saved',
      filterId: 'saved',
      notFilterable: true,
      style: { width: 110, textAlign: 'right' },
      content: (item) => item.saved,
      wrappedCell: (value, item) =>
        item.reaper.enabled && this.state.savings && this.state.savings.enabled ? reaperMoney(value, this.state.savings.currency) : '-',
    },
  ];

  componentDidMount() {
    this.props.setTitle('Clever Cloud Reaper');
    this.loadOverview();
  }

  loadOverview = () =>
    Promise.all([reaperCall('GET', '/overview'), reaperCall('GET', '/savings')]).then(([overview, savings]) =>
      this.setState({ overview: overview.json, savings: savings.status < 400 ? savings.json : null })
    );

  renderSavings() {
    const h = React.createElement;
    const s = this.state.savings;
    if (!s || !s.enabled) return null;
    const money = (v) => reaperMoney(v, s.currency);
    return h('div', { className: 'd-flex align-items-stretch gap-2 mb-3', style: { flexWrap: 'wrap' } },
      reaperTile('Saved today', money(s.today)),
      reaperTile('This month', money(s.this_month)),
      reaperTile('This year', money(s.this_year)),
      reaperTile('In all', money(s.total)),
      reaperTile('Saving right now', reaperMoney(s.saving_per_hour, s.currency, s.saving_per_hour > 0 && s.saving_per_hour < 1 ? 4 : 2) + ' / h',
        s.asleep + (s.asleep === 1 ? ' app' : ' apps') + ' put to sleep by the reaper')
    );
  }

  // filtered, sorted and paginated on the server, so the pages count what the filters keep
  fetchItems = (paginationState) => {
    const state = paginationState || {};
    const params = new URLSearchParams();
    params.set('page', String(state.page || 1));
    params.set('page_size', String(state.pageSize || 15));
    (state.sorted || []).slice(0, 1).forEach((s) => {
      params.set('sort', s.id);
      params.set('desc', String(!!s.desc));
    });
    (state.filtered || []).forEach((f) => params.set('filter.' + f.id, f.value));
    return reaperCall('GET', '/routes?' + params.toString()).then(({ status, json }) =>
      status >= 400 ? { data: [], pages: 1 } : { data: json.items || [], pages: json.pages || 1 }
    );
  };

  toggleKillSwitch = () => {
    const current = !!(this.state.overview && this.state.overview.settings && this.state.overview.settings.kill_switch);
    const text = current
      ? 'Turn the kill switch off? Apps without traffic are put to sleep again.'
      : 'Turn the kill switch on? No app is put to sleep until it is off again; wake ups keep working.';
    window.newConfirm(text).then((ok) => {
      if (ok) reaperCall('PUT', '/settings', { kill_switch: !current }).then(this.loadOverview);
    });
  };

  renderSummary() {
    const h = React.createElement;
    const o = this.state.overview;
    if (!o) return null;
    const by = o.by_status || {};
    const statuses = Object.keys(REAPER_LABELS).filter((s) => by[s] > 0);
    return h('div', { className: 'd-flex align-items-center gap-2 mb-3', style: { flexWrap: 'wrap' } },
      statuses.length === 0
        ? h('span', { style: { opacity: 0.7 } }, 'No app managed yet: open a route to enable the reaper on it.')
        : statuses.map((s) => h('span', { key: s, className: 'badge ' + REAPER_BADGES[s] }, by[s] + ' ' + REAPER_LABELS[s].toLowerCase())),
      h('span', { style: { opacity: 0.6, marginLeft: 'auto', fontSize: '0.8125rem' } },
        'cluster: ' + o.cluster_mode + ' · timezone: ' + o.timezone + ' · last run: ' + (o.last_tick && o.last_tick.at ? reaperAgo(o.last_tick.at) : 'not on this node'))
    );
  }

  render() {
    const h = React.createElement;
    const killSwitch = !!(this.state.overview && this.state.overview.settings && this.state.overview.settings.kill_switch);
    return h('div', null,
      reaperNotices(this.state.overview),
      this.renderSummary(),
      this.renderSavings(),
      h(Table, {
        parentProps: this.props,
        selfUrl: 'extensions/cloud-apim/clevercloud-reaper',
        defaultTitle: 'Clever Cloud Reaper',
        itemName: 'Route',
        columns: this.columns,
        fetchItems: this.fetchItems,
        defaultSort: 'name',
        defaultSortDesc: false,
        showActions: false,
        showLink: false,
        hideAddItemAction: true,
        rowNavigation: true,
        // '/edit/' in the url is what makes otoroshi center the page, like its other forms
        navigateTo: (item) => this.props.history.push(REAPER_PATH + '/edit/' + item.id),
        itemUrl: (item) => '/bo/dashboard' + REAPER_PATH + '/edit/' + item.id,
        extractKey: (item) => item.id,
        defaultValue: () => ({}),
        formSchema: {},
        formFlow: [],
        export: false,
        injectTopBar: () =>
          h('button', {
            type: 'button',
            className: 'btn btn-sm ' + (killSwitch ? 'btn-warning' : 'btn-secondary'),
            style: { marginLeft: 10 },
            title: 'stops the reaper from putting any app to sleep',
            onClick: this.toggleKillSwitch,
          }, h('i', { className: 'fas fa-power-off' }), killSwitch ? ' Kill switch is on' : ' Kill switch'),
      })
    );
  }
}

// ---------------------------------------------------------------------------------------------
// a route
// ---------------------------------------------------------------------------------------------

// a read only line, laid out like the otoroshi form fields
function ReaperField(props) {
  const h = React.createElement;
  return h('div', { className: 'row mb-3' },
    h('label', { className: 'col-xs-12 col-sm-2 col-form-label' }, props.label),
    h('div', { className: 'col-sm-10', style: { display: 'flex', alignItems: 'center', minHeight: 38, gap: 8, flexWrap: 'wrap' } }, props.content)
  );
}

// the app list needs the api token: without it, the id is typed
class CleverAppField extends Component {
  state = { apps: null };

  componentDidMount() {
    reaperCall('GET', '/clever/apps').then(({ status, json }) => this.setState({ apps: status >= 400 || !Array.isArray(json) ? [] : json }));
  }

  render() {
    const h = React.createElement;
    const apps = this.state.apps || [];
    // the form gives an empty object for a field without value
    const value = typeof this.props.value === 'string' ? this.props.value : '';
    if (apps.length === 0) {
      return h(TextInput, {
        label: this.props.label,
        help: this.props.help,
        placeholder: this.state.apps === null ? 'loading the clever cloud apps ...' : 'app_xxx',
        value: value,
        onChange: (v) => this.props.onChange(v),
      });
    }
    return h(SelectInput, {
      label: this.props.label,
      help: this.props.help,
      value: value,
      possibleValues: apps.map((a) => ({ label: a.label, value: a.id })),
      onChange: (v) => {
        // the owner comes with the app
        const app = apps.find((a) => a.id === v);
        this.props.rawOnChange(Object.assign({}, this.props.rawValue, { app_id: v, owner_id: app ? app.owner_id : this.props.rawValue.owner_id }));
      },
    });
  }
}

function reaperListItem(props, flow, schema) {
  return React.createElement(Form, {
    flow: flow,
    schema: schema,
    value: props.itemValue || {},
    onChange: (item) => {
      const items = (props.value || []).slice();
      items[props.idx] = item;
      props.onChange(items);
    },
  });
}

function UpRangeItem(props) {
  return reaperListItem(props, ['days', 'start', 'end'], {
    days: {
      type: 'array',
      props: {
        label: 'Days',
        help: 'Leave empty for every day',
        possibleValues: REAPER_DAYS.map((d) => ({ label: d, value: d })),
      },
    },
    start: { type: 'string', props: { label: 'From', placeholder: '08:00', help: 'HH:mm' } },
    end: { type: 'string', props: { label: 'To', placeholder: '19:00', help: 'HH:mm, before the start for a range running overnight' } },
  });
}

function MonitoringFilterItem(props) {
  return reaperListItem(props, ['source', 'name', 'regex'], {
    source: {
      type: 'select',
      props: {
        label: 'Source',
        possibleValues: [
          { label: 'Path', value: 'path' },
          { label: 'Path and query', value: 'uri' },
          { label: 'Header', value: 'header' },
          { label: 'User-Agent', value: 'user_agent' },
          { label: 'Query param', value: 'query' },
        ],
      },
    },
    name: {
      type: 'string',
      display: (v) => v.source === 'header' || v.source === 'query',
      props: { label: 'Name', placeholder: 'the header or query param name' },
    },
    regex: { type: 'string', props: { label: 'Regex', placeholder: '^/health$', help: 'Searched in the value, anchor it with ^ and $ for an exact match' } },
  });
}

const REAPER_DEFAULT_CONFIG = {
  app_id: null,
  owner_id: null,
  grace_period: 3600,
  fail_timeout: 900,
  ready_delay: 3,
  allow_waiting_page: true,
  api_behavior: 'hold',
  timezone: null,
  must_be_up_at: [],
  monitoring_filters: [],
  waiting_page: null,
};

class CleverCloudReaperRoutePage extends Component {
  state = { row: null, config: null, savings: null, dirty: false, busy: false, error: null, historyKey: 0 };

  routeId = () => this.props.match.params.routeId;

  componentDidMount() {
    this.props.setTitle('Clever Cloud Reaper');
    this.load();
    // the status moves on its own: follow it, without touching the settings being edited
    this.timer = setInterval(() => this.load(true), 5000);
  }

  componentWillUnmount() {
    clearInterval(this.timer);
  }

  load = (silent) =>
    reaperCall('GET', '/routes/' + this.routeId()).then(({ status, json }) => {
      if (status >= 400) {
        if (!silent) this.setState({ error: json.error || 'could not load the route' });
        return;
      }
      this.props.setTitle((json.reaper.enabled ? 'Update the reaper of ' : 'Enable the reaper on ') + json.name);
      if (json.reaper.enabled && json.reaper.app_id) {
        reaperCall('GET', '/apps/' + json.reaper.app_id + '/savings').then((res) =>
          this.setState({ savings: res.status < 400 && res.json.enabled ? res.json : null })
        );
      }
      const config = this.state.dirty && this.state.config
        ? this.state.config
        : Object.assign({}, REAPER_DEFAULT_CONFIG, json.reaper.config || {}, json.reaper.config ? {} : { app_id: json.reaper.app_id });
      this.setState({ row: json, config: config, error: null });
    });

  // like the other otoroshi forms: nothing to say when it worked, an alert when it did not
  report = ({ status, json }) => {
    if (status >= 400) window.newAlert(json.error || 'something went wrong');
    else if (json.warning) window.newAlert(json.warning);
    return status < 400;
  };

  run = (call) => {
    this.setState({ busy: true });
    return call
      .then((res) => {
        const ok = this.report(res);
        this.setState({ busy: false, historyKey: this.state.historyKey + 1 });
        return ok;
      })
      .then((ok) => this.load(true).then(() => ok));
  };

  confirm = (text, f) => window.newConfirm(text).then((ok) => ok && f());

  save = () => {
    const enabled = this.state.row.reaper.enabled;
    const call = enabled
      ? reaperCall('PUT', '/routes/' + this.routeId() + '/config', this.state.config)
      : reaperCall('POST', '/routes/' + this.routeId() + '/_enable', this.state.config);
    this.run(call).then((ok) => {
      if (ok) this.setState({ dirty: false });
    });
  };

  disable = () =>
    this.confirm('Disable the reaper on this route? If no other route keeps it under the reaper, the app is started again when it sleeps.', () =>
      this.run(reaperCall('POST', '/routes/' + this.routeId() + '/_disable'))
    );

  appAction = (action, question) => {
    const go = () => this.run(reaperCall('POST', '/apps/' + this.state.row.reaper.app_id + '/' + action));
    if (question) this.confirm(question, go);
    else go();
  };

  // laid out like the buttons otoroshi puts in its forms, "Manage organizations" and such
  renderActions() {
    const h = React.createElement;
    const row = this.state.row;
    const state = row.state || {};
    const status = row.reaper.enabled ? state.status : null;
    const busy = this.state.busy;
    const button = (key, icon, label, onClick, title) =>
      h('button', { key: key, type: 'button', className: 'btn btn-sm btn-primary', disabled: busy, title: title, onClick: onClick },
        h('i', { className: 'fas ' + icon }), ' ' + label);
    return h('div', { className: 'row mb-3' },
      h('label', { className: 'col-xs-12 col-sm-2 col-form-label' }),
      h('div', { className: 'col-sm-10 d-flex justify-content-end input-group-btn' },
        status === 'Down' || status === 'WaitingForShutdown'
          ? button('wake', 'fa-sun', 'Wake up', () => this.appAction('_wake'))
          : null,
        status === 'Up'
          ? button('reap', 'fa-moon', 'Put to sleep now', () => this.appAction('_reap', 'Put the app to sleep now, whatever its traffic?'))
          : null,
        status === 'Error'
          ? button('reset', 'fa-rotate-left', 'Reset', () => this.appAction('_reset', 'Reset the app? The reaper evaluates it again from scratch.'), 'leaves the error state')
          : null,
        h('a', { className: 'btn btn-sm btn-primary', href: '/bo/dashboard/routes/' + row.id + '?tab=flow' },
          h('i', { className: 'fas fa-road' }), ' Open the route')
      )
    );
  }

  statusSchema() {
    const h = React.createElement;
    const row = this.state.row;
    const state = row.state || {};
    const status = row.reaper.enabled ? state.status : null;
    const field = (label, content) => ({ type: ReaperField, props: { label: label, content: content } });
    const consoleUrl = state.owner_id && row.reaper.app_id
      ? 'https://console.clever-cloud.com/' + (state.owner_id.indexOf('user_') === 0 ? 'users/me' : 'organisations/' + state.owner_id) + '/applications/' + row.reaper.app_id
      : null;
    return {
      reaper: field('Reaper', row.reaper.enabled
        ? h('span', { className: 'badge bg-success' }, 'Enabled')
        : h('span', { className: 'badge bg-secondary' }, row.reaper.installed ? 'Disabled' : 'Not installed')),
      status: field('Status', [
        h('span', { key: 's' }, status ? reaperStatusBadge(status) : '-'),
        status && (state.error_cause || state.cause) ? h('span', { key: 'c', style: { opacity: 0.8 } }, state.error_cause || state.cause) : null,
      ]),
      app: field('Clever Cloud app', row.reaper.app_id
        ? [
            h('span', { key: 'n' }, state.name || row.reaper.app_id),
            h('code', { key: 'i' }, row.reaper.app_id),
            row.reaper.detected && !row.reaper.enabled ? h('span', { key: 'd', className: 'badge bg-info' }, 'guessed from the targets') : null,
            consoleUrl ? h('a', { key: 'l', href: consoleUrl, target: '_blank', rel: 'noopener noreferrer' }, 'console ', h('i', { className: 'fas fa-external-link-alt' })) : null,
          ]
        : 'no clever cloud app could be guessed from the targets of this route: choose one below'),
      clever_state: field('Clever Cloud state', state.clever_state ? h('code', null, state.clever_state) : '-'),
      last_access: field('Last access', status ? reaperAgo(state.last_access) + (state.last_access ? ' (' + reaperDate(state.last_access) + ')' : '') : '-'),
      next: field('Goes to sleep', status ? reaperNext(state) : '-'),
      last_change: field('Last change', status ? reaperDate(state.last_status_update) : '-'),
      routes: field('Shared with', (row.siblings || []).length === 0
        ? 'no other route'
        : row.siblings.map((s) => h('a', { key: s.id, href: '/bo/dashboard' + REAPER_PATH + '/edit/' + s.id }, s.name))),
      actions: { type: () => this.renderActions(), props: {} },
    };
  }

  settingsSchema = {
    app_id: {
      type: CleverAppField,
      props: { label: 'Clever Cloud app', help: 'The app behind this route. The routes of one app share its state: the most demanding settings win' },
    },
    owner_id: {
      type: 'string',
      props: { label: 'Owner', placeholder: 'orga_xxx', help: 'The organisation that owns the app. Discovered from the api token when empty' },
    },
    grace_period: {
      type: 'number',
      props: { label: 'Grace period', suffix: 'seconds', help: 'How long the app may go without traffic before it is put to sleep' },
    },
    timezone: {
      type: 'string',
      props: { label: 'Timezone', placeholder: 'Europe/Paris', help: 'The timezone of the time ranges. The default of the extension when empty' },
    },
    must_be_up_at: {
      type: 'array',
      props: {
        label: 'Must be up at',
        help: 'Time ranges where the app stays up whatever its traffic',
        component: UpRangeItem,
        defaultValue: { days: REAPER_DAYS.slice(0, 5), start: '08:00', end: '19:00' },
      },
    },
    allow_waiting_page: {
      type: 'bool',
      props: {
        label: 'Waiting page for browsers',
        help: 'Browsers (GET or HEAD asking for text/html) get a page that reloads itself once the app answers, whatever the mode below. Turn it off to apply the mode below to browsers too',
      },
    },
    api_behavior: {
      type: 'select',
      props: {
        label: 'Mode for the other requests',
        help: 'What a request gets while the app wakes up, unless it got the waiting page above: api calls, and browsers too when the waiting page is off',
        possibleValues: [
          { label: 'Held until the app is up', value: 'hold' },
          { label: '503 with a Retry-After header', value: 'unavailable' },
        ],
      },
    },
    fail_timeout: {
      type: 'number',
      props: { label: 'Fail timeout', suffix: 'seconds', help: 'How long a start or a stop may take before the app goes into error' },
    },
    ready_delay: {
      type: 'number',
      props: { label: 'Ready delay', suffix: 'seconds', help: 'How long held requests wait once clever cloud says the app is up' },
    },
    monitoring_filters: {
      type: 'array',
      props: {
        label: 'Monitoring filters',
        help: 'Requests matching any of these are not traffic: they neither keep the app awake nor wake it up',
        component: MonitoringFilterItem,
        defaultValue: { source: 'user_agent', name: null, regex: '(?i)statuscake' },
      },
    },
    waiting_page: {
      type: 'code',
      props: {
        label: 'Custom waiting page',
        mode: 'html',
        help: 'Your own html, the default page when empty. Placeholders: {{route_name}}, {{app_name}}, {{app_id}}, {{status}}. The reload script is added for you',
      },
    },
  };

  savingsSchema() {
    const h = React.createElement;
    const s = this.state.savings;
    const money = (v, d) => reaperMoney(v, s.currency, d);
    const field = (label, content) => ({ type: ReaperField, props: { label: label, content: content } });
    const c = s.cost;
    const size = (n, flavor) => n + ' × ' + flavor;
    const cost = !c
      ? 'not known yet: the size of the app and the prices of its zone are read from Clever Cloud within a few minutes'
      : [
          h('span', { key: 'min' }, h('strong', null, money(c.hourly_min, 4) + ' / h'), ' (' + size(c.min_instances, c.min_flavor) + ', ' + c.zone + ')'),
          c.hourly_max !== c.hourly_min
            ? h('span', { key: 'max', style: { opacity: 0.7 } }, 'up to ' + money(c.hourly_max, 4) + ' / h (' + size(c.max_instances, c.max_flavor) + ')')
            : null,
        ];
    return {
      cost: field('Cost when it runs', cost),
      current: field('Asleep now', s.current
        ? [h('strong', { key: 'v' }, money(s.current.saved)), h('span', { key: 's', style: { opacity: 0.8 } }, 'saved since ' + reaperDate(s.current.since))]
        : this.state.row.state && this.state.row.state.status === 'Down'
          ? h('span', { style: { opacity: 0.8 } }, 'not counted: the app was not put to sleep by the reaper, or before it counted savings')
          : '-'),
      saved: field('Saved', [
        h('span', { key: 't' }, 'today ', h('strong', null, money(s.today))),
        h('span', { key: 'm' }, 'this month ', h('strong', null, money(s.this_month))),
        h('span', { key: 'y' }, 'this year ', h('strong', null, money(s.this_year))),
        h('span', { key: 'a' }, 'in all ', h('strong', null, money(s.total))),
      ]),
      slept: field('Time asleep', s.slept_hours + ' h, over ' + s.sleeps + (s.sleeps === 1 ? ' sleep' : ' sleeps')),
      days: field('Last 30 days', h(ReaperBars, { days: s.last_30_days, currency: s.currency })),
    };
  }

  settingsFlow = [
    '<<<Clever Cloud app',
    'app_id',
    'owner_id',
    '<<<Going to sleep',
    'grace_period',
    'must_be_up_at',
    'timezone',
    '<<<Waking up',
    'allow_waiting_page',
    'api_behavior',
    'fail_timeout',
    'ready_delay',
    '>>>Monitoring filters',
    'monitoring_filters',
    '>>>Custom waiting page',
    'waiting_page',
  ];

  render() {
    const h = React.createElement;
    if (this.state.error) return h('div', { className: 'alert alert-danger' }, this.state.error);
    if (!this.state.row || !this.state.config) return h('div', null, 'loading ...');
    const row = this.state.row;
    const busy = this.state.busy;
    return h('div', null,
      h(Form, {
        flow: ['<<<Status', 'reaper', 'status', 'app', 'clever_state', 'last_access', 'next', 'last_change', 'routes', 'actions'],
        schema: this.statusSchema(),
        value: {},
        onChange: () => {},
      }),
      this.state.savings && row.reaper.enabled
        ? h(Form, {
            flow: ['<<<Savings', 'cost', 'current', 'saved', 'slept', 'days'],
            schema: this.savingsSchema(),
            value: {},
            onChange: () => {},
          })
        : null,
      h(Form, {
        flow: this.settingsFlow,
        schema: this.settingsSchema,
        value: this.state.config,
        onChange: (config) => this.setState({ config: config, dirty: true }),
      }),
      row.reaper.app_id && row.state && row.state.status
        ? h(Form, {
            flow: ['<<<History', 'history'],
            schema: { history: { type: CleverCloudReaperHistory, props: { appId: row.reaper.app_id, refresh: this.state.historyKey } } },
            value: {},
            onChange: () => {},
          })
        : null,
      h('hr'),
      // the bar every otoroshi form has at the bottom: disabling the reaper is this page's delete
      h('div', { className: 'displayGroupBtn float-end' },
        row.reaper.enabled
          ? h('button', { type: 'button', className: 'btn btn-danger', disabled: busy, title: 'disable the reaper on this route', onClick: this.disable }, 'Disable the reaper')
          : null,
        h('button', { type: 'button', className: 'btn btn-success', disabled: busy, onClick: this.save },
          h('i', { className: 'fas fa-edit' }), row.reaper.enabled ? ' Update the reaper' : ' Enable the reaper')
      )
    );
  }
}

class CleverCloudReaperHistory extends Component {
  columns = [
    { title: 'When', filterId: 'at', notFilterable: true, style: { width: 200 }, content: (t) => t.at, wrappedCell: (v) => reaperDate(v) },
    { title: 'From', filterId: 'from', style: { width: 150 }, content: (t) => REAPER_LABELS[t.from] || t.from, wrappedCell: (v, t) => reaperStatusBadge(t.from) },
    { title: 'To', filterId: 'to', style: { width: 150 }, content: (t) => REAPER_LABELS[t.to] || t.to, wrappedCell: (v, t) => reaperStatusBadge(t.to) },
    { title: 'Cause', filterId: 'cause', content: (t) => t.cause },
  ];

  componentDidUpdate(prev) {
    if (prev.refresh !== this.props.refresh && this.table) this.table.update();
  }

  render() {
    return React.createElement('div', { style: { position: 'relative', paddingTop: 48 } },
      React.createElement(Table, {
        parentProps: { params: {} },
        selfUrl: REAPER_PATH.substring(1),
        defaultTitle: 'History',
        itemName: 'Transition',
        columns: this.columns,
        fetchItems: () =>
          reaperCall('GET', '/apps/' + this.props.appId + '/history?page_size=500').then(({ status, json }) =>
            status >= 400 || !Array.isArray(json) ? [] : json.map((t, i) => Object.assign({ id: String(i) }, t))
          ),
        defaultSort: 'at',
        // the other way around as well: this is the latest first
        defaultSortDesc: false,
        showActions: false,
        showLink: false,
        hideAddItemAction: true,
        hideEditButton: true,
        rowNavigation: false,
        extractKey: (t) => t.id,
        defaultValue: () => ({}),
        formSchema: {},
        formFlow: [],
        export: false,
        injectTable: (table) => (this.table = table),
      })
    );
  }
}
