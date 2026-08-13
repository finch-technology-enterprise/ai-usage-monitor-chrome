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

let cachedClaudeOrgId = null;

async function directClaudeUsage() {
  let orgId = cachedClaudeOrgId;
  if (!orgId) {
    orgId = await getClaudeOrgFromCookie();
    if (!orgId) {
      const orgs = await jsonFetch('https://claude.ai/api/organizations', { credentials: 'include' });
      orgId = [...collectOrgIds(orgs)][0];
    }
    if (orgId) cachedClaudeOrgId = orgId;
  }
  if (!orgId) throw new Error('Could not determine Claude organization');
  return jsonFetch(`https://claude.ai/api/organizations/${encodeURIComponent(orgId)}/usage`, {
    credentials: 'include',
    headers: { 'anthropic-client-platform': 'web_claude_ai', 'Accept': 'application/json' }
  });
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

AIUsageProviders.register({
  id: 'claude',
  label: 'Claude',
  plan: 'Team / subscription',
  needs: 'session',
  openUrl: 'https://claude.ai/settings/usage',
  async refresh(silent = false) {
    const body = document.getElementById(`card-${this.id}-body`);
    if (!body) return false;
    if (!silent) body.innerHTML = '<div class="loading">Loading…</div>';
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
      return true;
    } catch (error) {
      if (!silent) body.innerHTML = errorHtml(`Could not load Claude: ${error.message}`, 'Sign in to claude.ai. If needed, keep a Claude tab open for the fallback relay.');
      return false;
    }
  },
  settingsHtml() {
    return `<p>Sign in normally to <strong>claude.ai</strong> and <strong>chatgpt.com</strong>. The extension does not copy or persist those session cookies.</p>`;
  },
  async readSettings() {}
});