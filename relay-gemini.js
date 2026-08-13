(() => {
  if (globalThis.__aiUsageGeminiRelayInstalled) return;
  globalThis.__aiUsageGeminiRelayInstalled = true;

  // No stable usage endpoint exists for gemini.google.com — see the research
  // comment in providers/gemini.js. This fetches the best-guess path from
  // page context (same-origin, so no CORS) so the plumbing is ready if Google
  // exposes a real endpoint; today it 404s and the adapter stays degraded.
  async function fetchJson(url, options = {}) {
    const response = await fetch(url, { ...options, credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'AI_USAGE_GEMINI') return;
    if (sender?.id !== chrome.runtime.id) return;
    (async () => {
      const data = await fetchJson('https://gemini.google.com/api/usage', { headers: { 'Accept': 'application/json' } });
      sendResponse({ ok: true, data });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
