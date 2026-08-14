// xAI Grok usage adapter.
//
// Endpoint research (2026-08-14 — grok.com JS bundle recon + anonymous curl
// probes; no signed-in session):
//   The app's generated REST client + feature-flag code were extracted from
//   the prod bundles (cdn.grok.com/_next/static/chunks/*.js):
//     GET  /rest/usage/free-usage-gates  -> { chat, imagine, voice, build },
//       each { allowance, remaining } (period cap + what's left; the app
//       clamps to positive ints and only treats a gate as meaningful when
//       allowance > 0). This is the endpoint the UI reads (feature-flagged
//       "free usage after limit" banner, polls every 15s).
//     GET  /rest/tasks/usage             -> { frequentUsage, frequentLimit,
//       occasionalUsage, occasionalLimit } (Grok Tasks feature only).
//     POST /rest/rate-limits             -> body { requestKind, modelName };
//       response { windowSizeSeconds, remainingQueries, ... } (per-window
//       remaining, keyed by the enum the app sends when composing).
//     getGrokCreditsConfig               -> Connect-RPC (protobuf service
//       GrokBuildBilling, module 5802746/9096207): { config: {
//       creditUsagePercent, onDemandCap, onDemandUsed, currentPeriod, ... } }.
//       This drives the real usage-pool panel but only exists for
//       SuperGrok/X Premium subscribers and speaks an obfuscated RPC
//       transport — too unstable to parse.
//   Anonymous probes of the GET endpoints return HTTP 401
//   {"code":16,"message":"No credentials presented..."} (session-gated, NOT
//   the 403 bot-wall) with or without x-statsig-id, so they are plain
//   session-cookie JSON endpoints. The app injects x-statsig-id (obfuscated
//   per-path signer) + x-xai-request-id on every request, but the 401-implies
//   auth-first response suggests GETs are not header-enforced; unverified for
//   signed-in sessions — if the server enforces the header, refresh() falls
//   through to the degraded state.
//   Adapter uses free-usage-gates: remaining counts per product (perplexity
//   style), no invented percentages (no used/limit pair), no plan badge (no
//   plan field exists in any verified payload). If the shape drifts or the
//   gates are all null (e.g. non-gated SuperGrok accounts), refresh()
//   degrades to the "not available" state.

const GROK_USAGE_URL = 'https://grok.com/rest/usage/free-usage-gates';

function grokGate(raw) {
  if (raw == null) return null;
  const allowance = firstNumber(raw.allowance, raw.limit, raw.max, raw.allowed);
  const remaining = firstNumber(raw.remaining, raw.remaining_count, raw.remainingCount, raw.count, raw.left);
  if (allowance == null || allowance <= 0 || remaining == null) return null;
  return { allowance, remaining };
}

function grokCountRow(label, gate) {
  if (!gate) return '';
  return `
    <div class="metric">
      <div class="metric-row">
        <span class="metric-label">${escapeHtml(label)}</span>
        <span class="metric-value">${Math.round(gate.remaining)} left</span>
      </div>
      <div class="metric-meta">of ${Math.round(gate.allowance)}</div>
    </div>`;
}

function grokUsageHtml(data) {
  const products = [
    ['Chat', data?.chat ?? data?.chat_gates],
    ['Image & video', data?.imagine ?? data?.imagine_gates],
    ['Voice', data?.voice ?? data?.voice_gates],
    ['Build', data?.build ?? data?.build_gates]
  ];
  return products.map(([label, gate]) => grokCountRow(label, grokGate(gate))).join('');
}

function directGrokUsage() {
  return jsonFetch(GROK_USAGE_URL, {
    credentials: 'include',
    headers: { 'Accept': 'application/json' }
  });
}

AIUsageProviders.register({
  id: 'grok',
  label: 'xAI Grok',
  needs: 'session',
  openUrl: 'https://grok.com',
  async refresh(silent = false) {
    const body = document.getElementById(`card-${this.id}-body`);
    if (!body) return false;
    if (!silent) body.innerHTML = '<div class="loading">Loading…</div>';
    try {
      let data;
      try {
        data = await directGrokUsage();
      } catch {
        data = await relayMessage('https://grok.com/*', { type: 'AI_USAGE_GROK' });
      }
      const html = grokUsageHtml(data);
      if (!html) throw new Error('Unexpected Grok usage response format');
      body.innerHTML = html;
      return true;
    } catch {
      if (!silent) body.innerHTML = errorHtml('Usage not available for xAI Grok yet.', 'Sign in to grok.com and keep a Grok tab open for the fallback relay.');
      return false;
    }
  },
  settingsHtml() {
    return `<p>Sign in normally to <strong>grok.com</strong>. The extension does not copy or persist those session cookies.</p>`;
  },
  async readSettings() {}
});
