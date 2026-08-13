// Google Gemini usage adapter.
//
// Endpoint research (2026-08-13, no signed-in session — curl probes):
//   GET https://gemini.google.com/api/usage | /api/v1/usage | /api/plan |
//       /api/quota | /api/prompts  -> HTTP 404 (paths do not exist)
//   GET https://gemini.google.com/usage  -> HTTP 200 but serves the SPA HTML
//       shell (text/html) — a client-side route, not a JSON quota endpoint
//   POST https://gemini.google.com/_/BardChatUi/data/batchexecute -> HTTP 400
//       with an empty request body; the internal RPC exists but is
//       session-gated and speaks an opaque, unstable protocol
//   Community sources: DuckDuckGo is bot-blocked; Bing surfaces only
//   marketing pages; no project documents a working usage/quota endpoint for
//   the consumer Gemini app, which does not expose quota percentages the way
//   ChatGPT/Claude do.
// No stable endpoint was found, so this adapter ships in the degraded state
// (Task 8 brief Step 2): refresh() renders the "not available" copy and
// returns false. relay-gemini.js is wired to a page-context fetch of the
// best-guess /api/usage path so the plumbing is ready if Google ever exposes
// a real endpoint — swap the URL there and in refresh() to light the card up.

AIUsageProviders.register({
  id: 'gemini',
  label: 'Google Gemini',
  needs: 'session',
  openUrl: 'https://gemini.google.com',
  async refresh(silent = false) {
    const body = document.getElementById(`card-${this.id}-body`);
    if (!body) return false;
    body.innerHTML = errorHtml('Usage not available for Google Gemini yet.', 'Your signed-in Gemini session is used; the endpoint may appear in a future update.');
    return false;
  },
  settingsHtml() {
    return `<p>Sign in normally to <strong>gemini.google.com</strong>. The extension does not copy or persist those session cookies.</p>`;
  },
  async readSettings() {}
});
