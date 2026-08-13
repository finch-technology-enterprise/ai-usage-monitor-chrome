// Cursor usage adapter.
//
// Endpoint research (2026-08-14, no signed-in session — curl probes):
//   GET https://curl.cursorapi.com/usage  -> DNS NXDOMAIN (domain retired)
//   GET https://api2.cursorapi.com | www2.cursor.sh | api.cursorapi.com
//                                        -> DNS NXDOMAIN (domains retired)
//   GET https://cursor.com/api/usage      -> HTTP 401
//       {"error":"not_authenticated","description":"The user does not have
//       an active session or is not authenticated"} — LIVE, session-gated
//       JSON endpoint on cursor.com itself (the community-documented
//       curl.cursorapi.com host no longer exists; the path survived on the
//       main domain). WorksOS session cookie is `WorkosCursorSessionToken`
//       on cursor.com.
// The response shape is community-documented (Task 9 brief Step 2 + public
// docs): { used, limit, max_usage_percentage,
//          subscription: { end_of_month, kind } } where used/limit are
//   requests and max_usage_percentage is the quota bar. No signed-in session
//   was available to capture a live payload, so the parser below accepts
//   that shape defensively (alias chains, toPercent normalization). The
//   `plan` badge is omitted until a live payload confirms a plan field.
//   If the shape drifts, refresh() degrades to the "not available" state.

function directCursorUsage() {
  return jsonFetch('https://cursor.com/api/usage', {
    credentials: 'include',
    headers: { 'Accept': 'application/json' }
  });
}

function cursorUsageHtml(data) {
  const w = data?.usage ?? data?.quota ?? data;
  const pct = firstNumber(w?.max_usage_percentage, w?.usage_percent, w?.utilization, w?.percent);
  const used = firstNumber(w?.used, w?.usage);
  const limit = firstNumber(w?.limit, w?.allowed, w?.quota);
  const ratio = used != null && limit ? (used / limit) * 100 : null;
  if (pct == null && ratio == null) return '';
  const detail = used != null && limit != null ? `${Math.round(used)} / ${Math.round(limit)}` : '';
  const reset = resetMeta(w?.end_of_month ?? w?.reset_at ?? w?.resets_at ?? w?.subscription?.end_of_month);
  return metricHtml('Cursor usage', toPercent(pct ?? ratio), reset, detail);
}

AIUsageProviders.register({
  id: 'cursor',
  label: 'Cursor',
  needs: 'session',
  openUrl: 'https://cursor.com/settings',
  async refresh(silent = false) {
    const body = document.getElementById(`card-${this.id}-body`);
    if (!body) return false;
    if (!silent) body.innerHTML = '<div class="loading">Loading…</div>';
    try {
      let data;
      try {
        data = await directCursorUsage();
      } catch {
        data = await relayMessage('https://cursor.com/*', { type: 'AI_USAGE_CURSOR' });
      }
      const html = cursorUsageHtml(data);
      if (!html) throw new Error('Unexpected Cursor usage response format');
      body.innerHTML = html;
      return true;
    } catch {
      if (!silent) body.innerHTML = errorHtml('Usage not available for Cursor yet.', 'Sign in to cursor.com and keep a Cursor tab open for the fallback relay.');
      return false;
    }
  },
  settingsHtml() {
    return `<p>Sign in normally to <strong>cursor.com</strong>. The extension does not copy or persist those session cookies.</p>`;
  },
  async readSettings() {}
});
