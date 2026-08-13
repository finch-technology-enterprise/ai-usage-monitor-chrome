(() => {
  if (globalThis.__aiUsageCursorRelayInstalled) return;
  globalThis.__aiUsageCursorRelayInstalled = true;

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, { ...options, credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'AI_USAGE_CURSOR') return;
    if (sender?.id !== chrome.runtime.id) return;
    (async () => {
      const data = await fetchJson('https://cursor.com/api/usage', { headers: { 'Accept': 'application/json' } });
      sendResponse({ ok: true, data });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
