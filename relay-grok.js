(() => {
  if (globalThis.__aiUsageGrokRelayInstalled) return;
  globalThis.__aiUsageGrokRelayInstalled = true;

  // Same endpoint as directGrokUsage() in providers/grok.js
  // (consistency between the direct and relay paths). The page-context fetch
  // carries grok.com session cookies; the app's x-statsig-id middleware does
  // NOT apply to a raw fetch here, which is fine for the GET usage endpoint
  // (anonymous probes show a 401 auth-gate, not a header bot-wall).

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, { ...options, credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'AI_USAGE_GROK') return;
    if (sender?.id !== chrome.runtime.id) return;
    (async () => {
      const data = await fetchJson('https://grok.com/rest/usage/free-usage-gates', { headers: { 'Accept': 'application/json' } });
      sendResponse({ ok: true, data });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
