// Mistral Le Chat usage adapter.
//
// Endpoint research (2026-08-14 — live probes + community):
//   Le Chat's usage API is a tRPC procedure (Next.js app router):
//     GET https://chat.mistral.ai/api/trpc/user.limits?batch=1&input=...
//     input = URL-encoded {"0":{"json":{"stableAnonymousIdentifier":"<id>"}}}
//     headers: trpc-accept: application/jsonl, x-trpc-source: nextjs-react
//   Community source: 6Kmfi6HP/mistral2api (README §4 "额度系统 (user.limits)",
//   captures/user-limits-detail.txt, lechat_client.py check_limits) — a
//   reverse-engineered Le Chat client that documents this exact procedure,
//   the stableAnonymousIdentifier input, and the superjson response layout.
//   Live probe (anonymous, no cookies, fresh random id) confirmed today:
//     HTTP 200, NDJSON lines ending in
//     {"json":[2,0,[[{"message_send":{"remainingPoints":5,"points":5},
//     "fast_reasoning":{"remainingPoints":40,"points":40},
//     "deep_research":{"remainingPoints":5,"points":5},
//     "fast_deep_research":{"remainingPoints":5,"points":5},
//     "connector_tool_call":{"remainingPoints":100,"points":100}}]]]}
//   i.e. a per-capability map of { remainingPoints, points } (points = the
//   period cap, remainingPoints = what's left). The limits object sits at
//   obj.json[2][2][0][0] of the last NDJSON line; parse defensively with a
//   recursive scan instead of trusting the index.
//   Caveats:
//   - The README (2026-07-29) reported pure-curl 403s from Cloudflare TLS
//     fingerprinting; today's probes passed from plain Python. The direct
//     fetch may be flaky — the relay fallback (page context, browser TLS)
//     exists for that. A signed-in session's exact response is unverified;
//     anonymous IDs return anonymous bucket counts. `stableAnonymousIdentifier`
//     is regenerated per popup/tab session (never persisted), which keeps the
//     card honest for signed-in users but means anonymous visitors see fresh
//     counts each popup open.
//   - No plan field exists in this payload, so there is no plan badge.
//   - Endpoint exposes remaining counts only → count-rows rendering
//     (perplexity style), no invented percentages.
//   If the shape drifts, refresh() degrades to the "not available" state.

const MISTRAL_LIMITS_URL = 'https://chat.mistral.ai/api/trpc/user.limits';

function mistralAnonymousId() {
  if (!mistralAnonymousId.value) {
    mistralAnonymousId.value = Math.random().toString(36).slice(2, 8) || 'mistral';
  }
  return mistralAnonymousId.value;
}

function mistralLimitsUrl() {
  const input = JSON.stringify({ 0: { json: { stableAnonymousIdentifier: mistralAnonymousId() } } });
  return `${MISTRAL_LIMITS_URL}?batch=1&input=${encodeURIComponent(input)}`;
}

function findMistralLimitsObject(value, depth = 0) {
  if (value == null || depth > 8 || typeof value !== 'object') return null;
  if (!Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.some(([, v]) => v && typeof v === 'object' && firstNumber(v?.remainingPoints ?? v?.remaining_points ?? v?.remaining) != null)) {
      return value;
    }
    for (const [, v] of entries) {
      const found = findMistralLimitsObject(v, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const item of value) {
    const found = findMistralLimitsObject(item, depth + 1);
    if (found) return found;
  }
  return null;
}

function parseMistralLimits(text) {
  for (const line of String(text).split('\n')) {
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const found = findMistralLimitsObject(obj?.json);
    if (found) return found;
  }
  return null;
}

async function directMistralUsage() {
  const response = await fetch(mistralLimitsUrl(), {
    credentials: 'include',
    headers: {
      'Accept': 'application/jsonl',
      'trpc-accept': 'application/jsonl',
      'x-trpc-source': 'nextjs-react'
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const limits = parseMistralLimits(await response.text());
  if (!limits) throw new Error('Unexpected Mistral limits response format');
  return limits;
}

const MISTRAL_CAPABILITY_LABELS = {
  message_send: 'Messages',
  fast_reasoning: 'Fast reasoning',
  deep_research: 'Deep research',
  fast_deep_research: 'Fast deep research',
  connector_tool_call: 'Connector tool calls'
};

function mistralLabel(key) {
  return MISTRAL_CAPABILITY_LABELS[key] ?? key.replaceAll('_', ' ');
}

function mistralCountRow(key, entry) {
  const remaining = firstNumber(entry?.remainingPoints ?? entry?.remaining_points ?? entry?.remaining);
  if (remaining == null) return '';
  const total = firstNumber(entry?.points ?? entry?.limit ?? entry?.max);
  const meta = total != null && total !== remaining ? `of ${Math.round(total)}` : '';
  return `
    <div class="metric">
      <div class="metric-row">
        <span class="metric-label">${escapeHtml(mistralLabel(key))}</span>
        <span class="metric-value">${Math.round(remaining)} left</span>
      </div>
      ${meta ? `<div class="metric-meta">${escapeHtml(meta)}</div>` : ''}
    </div>`;
}

function mistralUsageHtml(data) {
  return Object.entries(data ?? {}).map(([key, entry]) => mistralCountRow(key, entry)).join('');
}

AIUsageProviders.register({
  id: 'mistral',
  label: 'Mistral Le Chat',
  needs: 'session',
  openUrl: 'https://chat.mistral.ai',
  async refresh(silent = false) {
    const body = document.getElementById(`card-${this.id}-body`);
    if (!body) return false;
    if (!silent) body.innerHTML = '<div class="loading">Loading…</div>';
    try {
      let data;
      try {
        data = await directMistralUsage();
      } catch {
        data = await relayMessage('https://chat.mistral.ai/*', { type: 'AI_USAGE_MISTRAL' });
      }
      const html = mistralUsageHtml(data);
      if (!html) throw new Error('Unexpected Mistral usage response format');
      body.innerHTML = html;
      return true;
    } catch {
      if (!silent) body.innerHTML = errorHtml('Usage not available for Mistral Le Chat yet.', 'Sign in to chat.mistral.ai and keep a Mistral Le Chat tab open for the fallback relay.');
      return false;
    }
  },
  settingsHtml() {
    return `<p>Sign in normally to <strong>chat.mistral.ai</strong>. The extension does not copy or persist those session cookies.</p>`;
  },
  async readSettings() {}
});
