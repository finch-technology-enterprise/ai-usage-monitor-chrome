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
  const session = await jsonFetch('https://chatgpt.com/api/auth/session', { credentials: 'include', headers: { 'Accept': 'application/json' } });
  const token = findAccessToken(session);
  if (!token) throw new Error('ChatGPT session did not expose an access token');
  const jwt = decodeJwtPayload(token);
  const accountId = findAccountId(session) || findAccountId(jwt);
  const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };
  if (accountId) headers['ChatGPT-Account-Id'] = accountId;
  return jsonFetch('https://chatgpt.com/backend-api/wham/usage', { credentials: 'include', headers });
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

AIUsageProviders.register({
  id: 'chatgpt',
  label: 'ChatGPT / Codex',
  plan: 'Plus',
  needs: 'session',
  openUrl: 'https://chatgpt.com/#usage',
  async refresh(silent = false) {
    const body = document.getElementById(`card-${this.id}-body`);
    if (!body) return false;
    if (!silent) body.innerHTML = '<div class="loading">Loading…</div>';
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
      if (data?.plan_type) document.getElementById('card-chatgpt-plan').textContent = String(data.plan_type).replaceAll('_', ' ');
      return true;
    } catch (error) {
      if (!silent) body.innerHTML = errorHtml(`Could not load ChatGPT/Codex: ${error.message}`, 'Sign in to chatgpt.com. If needed, keep a ChatGPT tab open for the fallback relay.');
      return false;
    }
  },
  settingsHtml() {
    return `<p>Sign in normally to <strong>claude.ai</strong> and <strong>chatgpt.com</strong>. The extension does not copy or persist those session cookies.</p>`;
  },
  async readSettings() {}
});
