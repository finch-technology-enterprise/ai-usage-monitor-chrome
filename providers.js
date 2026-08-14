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
  const tone = p >= 85 ? 'bar-danger' : p >= 60 ? 'bar-warn' : 'bar-ok';
  return `
    <div class="metric">
      <div class="metric-row">
        <span class="metric-label">${escapeHtml(label)}</span>
        <span class="metric-value">${escapeHtml(right || `${shown}%`)}</span>
      </div>
      <div class="bar"><div class="${tone}" style="width:${p}%"></div></div>
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

async function textFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
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

const DEFAULT_ENABLED = ['opencode', 'claude', 'chatgpt'];

async function loadProviderPrefs() {
  const stored = await chrome.storage.local.get(['enabledProviders', 'opencodeApiKey']);
  let map = stored.enabledProviders;
  if (map == null || typeof map !== 'object') {
    map = stored.opencodeApiKey ? Object.fromEntries(DEFAULT_ENABLED.map((id) => [id, true])) : {};
    await chrome.storage.local.set({ enabledProviders: map });
  }
  return { enabled: new Set(Object.entries(map).filter(([, v]) => v).map(([id]) => id)) };
}

const AIUsageProviders = {
  list: [],
  register(provider) {
    if (!provider?.id || !provider.label || typeof provider.refresh !== 'function') {
      throw new Error(`Invalid provider registration: ${provider?.id}`);
    }
    this.list.push(provider);
  },
  enabledIds(ids) {
    return this.list.filter((p) => ids.has(p.id));
  }
};
