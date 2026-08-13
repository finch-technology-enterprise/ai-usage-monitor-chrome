const ENDPOINTS = {
  opencode: 'https://opencode.ai/zen/go/v1/usage',
  claude: 'https://claude.ai',
  chatgpt: 'https://chatgpt.com'
};

const $ = (id) => document.getElementById(id);

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function firstNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toPercent(value) {
  const n = firstNumber(value);
  if (n == null) return null;
  // Claude sometimes returns 0..1 and sometimes 0..100 depending on endpoint/client.
  return clampPercent(n <= 1 && n >= 0 ? n * 100 : n);
}

function parseResetTarget(raw) {
  if (raw == null) return null;
  let targetMs;
  if (typeof raw === 'number') {
    // epoch ms > 2e10; epoch seconds ~1e9..2e10 (until year 2033); smaller values are seconds-from-now
    targetMs = raw > 2e10 ? raw : raw > 1e9 ? raw * 1000 : Date.now() + raw * 1000;
  } else {
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) return null;
    targetMs = parsed;
  }
  return targetMs;
}

function resetText(raw) {
  const targetMs = parseResetTarget(raw);
  if (targetMs == null) return '';
  const diff = targetMs - Date.now();
  if (diff <= 0) return 'resetting now';
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return `resets in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 48) return `resets in ${hours}h${mins ? ` ${mins}m` : ''}`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `resets in ${days}d${remHours ? ` ${remHours}h` : ''}`;
}

function resetMeta(raw) {
  const targetMs = parseResetTarget(raw);
  if (targetMs == null) return '';
  const absolute = `Resets ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(targetMs)}`;
  if (targetMs <= Date.now()) return absolute;
  return `${absolute} · ${resetText(raw)}`;
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return `$${n.toFixed(n < 10 ? 2 : 1)}`;
}

function metricHtml(label, percent, meta = '', right = null) {
  const p = clampPercent(percent);
  if (p == null) return '';
  const shown = p % 1 === 0 ? p.toFixed(0) : p.toFixed(1);
  return `
    <div class="metric">
      <div class="metric-row">
        <span class="metric-label">${escapeHtml(label)}</span>
        <span class="metric-value">${escapeHtml(right || `${shown}%`)}</span>
      </div>
      <div class="bar"><div style="width:${p}%"></div></div>
      ${meta ? `<div class="metric-meta">${escapeHtml(meta)}</div>` : ''}
    </div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function errorHtml(message, action = '') {
  return `<div class="error">${escapeHtml(message)}</div>${action ? `<div class="hint">${escapeHtml(action)}</div>` : ''}`;
}

async function jsonFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* keep text for error */ }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}${data?.error?.message ? `: ${data.error.message}` : ''}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function refreshOpenCode() {
  const body = $('opencodeBody');
  body.innerHTML = '<div class="loading">Loading…</div>';
  const { opencodeApiKey = '' } = await chrome.storage.local.get('opencodeApiKey');
  if (!opencodeApiKey.trim()) {
    body.innerHTML = errorHtml('OpenCode API key not configured.', 'Open Settings and paste your OpenCode Go API key.');
    return;
  }

  try {
    const data = await jsonFetch(ENDPOINTS.opencode, {
      headers: {
        'Authorization': `Bearer ${opencodeApiKey.trim()}`,
        'Accept': 'application/json'
      }
    });

    const usage = data?.usage ?? data;
    const windows = [
      ['5 hour', usage?.rolling5h ?? usage?.rolling ?? usage?.five_hour ?? usage?.fiveHour],
      ['Weekly', usage?.weekly ?? usage?.seven_day ?? usage?.sevenDay],
      ['Monthly', usage?.monthly ?? usage?.thirty_day ?? usage?.month]
    ];

    const html = windows.map(([label, w]) => {
      if (!w) return '';
      const used = firstNumber(w.usageDollars, w.usage_dollars, w.used, w.usage);
      const limit = firstNumber(w.limitDollars, w.limit_dollars, w.limit, w.allowance);
      const pctRaw = firstNumber(w.usagePercent, w.usage_percent, w.utilization, w.percent);
      const pct = pctRaw != null ? clampPercent(pctRaw) : (limit && used != null ? clampPercent((used / limit) * 100) : null);
      const reset = resetMeta(w.resetsAt ?? w.resetAt ?? w.reset_at ?? w.resetInSec ?? w.reset_in_sec ?? w.resets_at);
      const detail = used != null && limit != null ? `${money(used)} / ${money(limit)}` : '';
      return metricHtml(label, pct, reset, detail || null);
    }).join('');

    if (!html) throw new Error('Unexpected OpenCode usage response format');
    body.innerHTML = html;
  } catch (error) {
    body.innerHTML = errorHtml(`Could not load OpenCode Go: ${error.message}`, 'Verify the API key in Settings.');
  }
}

async function getClaudeOrgFromCookie() {
  const candidates = ['lastActiveOrg', 'lastActiveOrganization'];
  for (const name of candidates) {
    const cookie = await chrome.cookies.get({ url: 'https://claude.ai', name });
    if (cookie?.value) return decodeURIComponent(cookie.value).replace(/^"|"$/g, '');
  }
  return null;
}

function collectOrgIds(value, out = new Set()) {
  if (!value || out.size > 25) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectOrgIds(item, out);
  } else if (typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      if ((key === 'uuid' || key === 'id' || key === 'organization_uuid') && typeof val === 'string' && val.length > 8) out.add(val);
      collectOrgIds(val, out);
    }
  }
  return out;
}

async function directClaudeUsage() {
  let orgId = await getClaudeOrgFromCookie();
  if (!orgId) {
    const orgs = await jsonFetch(`${ENDPOINTS.claude}/api/organizations`, { credentials: 'include' });
    orgId = [...collectOrgIds(orgs)][0];
  }
  if (!orgId) throw new Error('Could not determine Claude organization');
  return jsonFetch(`${ENDPOINTS.claude}/api/organizations/${encodeURIComponent(orgId)}/usage`, {
    credentials: 'include',
    headers: { 'anthropic-client-platform': 'web_claude_ai', 'Accept': 'application/json' }
  });
}

async function relayMessage(hostPattern, message) {
  const tabs = await chrome.tabs.query({ url: hostPattern });
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, message);
      if (response?.ok) return response.data;
    } catch { /* try next */ }
  }
  throw new Error('Open the provider website in a tab and try Refresh again');
}

function claudeUsageHtml(data) {
  const rows = [
    ['Current session', data?.five_hour ?? data?.fiveHour],
    ['Weekly limits', data?.seven_day ?? data?.sevenDay],
    ['Weekly Sonnet', data?.seven_day_sonnet ?? data?.sevenDaySonnet],
    ['Weekly Opus', data?.seven_day_opus ?? data?.sevenDayOpus]
  ];
  let html = rows.map(([label, w]) => {
    if (!w) return '';
    const pct = toPercent(firstNumber(w.utilization, w.utilization_pct, w.used_percent, w.percent));
    const reset = resetMeta(w.resets_at ?? w.reset_at ?? w.resetAt);
    return metricHtml(label, pct, reset);
  }).join('');

  const extra = data?.extra_usage ?? data?.extraUsage;
  if (extra) {
    const spent = firstNumber(extra.current_spending, extra.currentSpending, extra.spent, extra.used);
    const limit = firstNumber(extra.monthly_limit, extra.monthlyLimit, extra.budget_limit, extra.limit);
    if (spent != null && limit) {
      const divisor = limit > 500 ? 100 : 1; // some Claude payloads use cents
      const usedUsd = spent / divisor;
      const limitUsd = limit / divisor;
      html += metricHtml('Extra usage', (usedUsd / limitUsd) * 100, '', `${money(usedUsd)} / ${money(limitUsd)}`);
    }
  }
  return html;
}

async function refreshClaude() {
  const body = $('claudeBody');
  body.innerHTML = '<div class="loading">Loading…</div>';
  try {
    let data;
    try {
      data = await directClaudeUsage();
    } catch {
      data = await relayMessage('https://claude.ai/*', { type: 'AI_USAGE_CLAUDE' });
    }
    const html = claudeUsageHtml(data);
    if (!html) throw new Error('Unexpected Claude usage response format');
    body.innerHTML = html;
  } catch (error) {
    body.innerHTML = errorHtml(`Could not load Claude: ${error.message}`, 'Sign in to claude.ai. If needed, keep a Claude tab open for the fallback relay.');
  }
}

function findAccessToken(value, depth = 0) {
  if (!value || depth > 6) return null;
  if (typeof value === 'string') return value.startsWith('eyJ') && value.split('.').length >= 2 ? value : null;
  if (Array.isArray(value)) {
    for (const v of value) { const found = findAccessToken(v, depth + 1); if (found) return found; }
  } else if (typeof value === 'object') {
    for (const key of ['accessToken', 'access_token', 'token']) {
      if (typeof value[key] === 'string' && value[key]) return value[key];
    }
    for (const v of Object.values(value)) { const found = findAccessToken(v, depth + 1); if (found) return found; }
  }
  return null;
}

function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1];
    if (!part) return {};
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    return JSON.parse(atob(normalized));
  } catch { return {}; }
}

function findAccountId(value, depth = 0) {
  if (!value || depth > 7) return null;
  if (typeof value !== 'object') return null;
  for (const key of ['chatgpt_account_id', 'chatgptAccountId', 'account_id', 'accountId']) {
    if (typeof value[key] === 'string' && value[key]) return value[key];
  }
  for (const v of Object.values(value)) {
    const found = findAccountId(v, depth + 1);
    if (found) return found;
  }
  return null;
}

async function directChatGptUsage() {
  const session = await jsonFetch(`${ENDPOINTS.chatgpt}/api/auth/session`, { credentials: 'include', headers: { 'Accept': 'application/json' } });
  const token = findAccessToken(session);
  if (!token) throw new Error('ChatGPT session did not expose an access token');
  const jwt = decodeJwtPayload(token);
  const accountId = findAccountId(session) || findAccountId(jwt);
  const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };
  if (accountId) headers['ChatGPT-Account-Id'] = accountId;
  return jsonFetch(`${ENDPOINTS.chatgpt}/backend-api/wham/usage`, { credentials: 'include', headers });
}

function chatGptUsageHtml(data) {
  const rate = data?.rate_limit ?? data?.rateLimit ?? {};
  const windows = [rate.primary_window ?? rate.primaryWindow, rate.secondary_window ?? rate.secondaryWindow];
  const weekly = windows.find((w) => w && (w.limit_window_seconds ?? w.limitWindowSeconds ?? 0) >= 604800) ?? windows.find(Boolean) ?? null;
  const rows = [
    ['Weekly usage limit', weekly]
  ];
  let html = rows.map(([label, w]) => {
    if (!w) return '';
    const pct = toPercent(firstNumber(w.used_percent, w.usedPercent, w.utilization, w.percent));
    const reset = resetMeta(w.reset_at ?? w.resetAt ?? w.resets_at);
    return metricHtml(label, pct, reset);
  }).join('');

  const additional = data?.additional_rate_limits ?? data?.additionalRateLimits;
  if (Array.isArray(additional)) {
    for (const item of additional.slice(0, 3)) {
      const w = item?.rate_limit ?? item?.rateLimit ?? item;
      const pct = toPercent(firstNumber(w.used_percent, w.usedPercent, w.utilization, w.percent));
      if (pct == null) continue;
      const label = item.limit_name ?? item.limitName ?? item.metered_feature ?? 'Additional';
      html += metricHtml(label, pct, resetMeta(w.reset_at ?? w.resetAt));
    }
  }
  return html;
}

async function refreshChatGpt() {
  const body = $('chatgptBody');
  body.innerHTML = '<div class="loading">Loading…</div>';
  try {
    let data;
    try {
      data = await directChatGptUsage();
    } catch {
      data = await relayMessage('https://chatgpt.com/*', { type: 'AI_USAGE_CHATGPT' });
    }
    const html = chatGptUsageHtml(data);
    if (!html) throw new Error('Unexpected ChatGPT/Codex usage response format');
    body.innerHTML = html;
    if (data?.plan_type) $('chatgptPlan').textContent = String(data.plan_type).replaceAll('_', ' ');
  } catch (error) {
    body.innerHTML = errorHtml(`Could not load ChatGPT/Codex: ${error.message}`, 'Sign in to chatgpt.com. If needed, keep a ChatGPT tab open for the fallback relay.');
  }
}

async function refreshAll() {
  const button = $('refreshAll');
  button.classList.add('spinning');
  button.disabled = true;
  await Promise.allSettled([refreshOpenCode(), refreshClaude(), refreshChatGpt()]);
  $('updatedAt').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  button.classList.remove('spinning');
  button.disabled = false;
}

for (const button of document.querySelectorAll('[data-open]')) {
  button.addEventListener('click', () => chrome.tabs.create({ url: button.dataset.open }));
}
$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('refreshAll').addEventListener('click', refreshAll);

refreshAll();
