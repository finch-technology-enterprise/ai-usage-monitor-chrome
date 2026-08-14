(() => {
  if (globalThis.__aiUsageCopilotRelayInstalled) return;
  globalThis.__aiUsageCopilotRelayInstalled = true;

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, { ...options, credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'AI_USAGE_COPILOT') return;
    if (sender?.id !== chrome.runtime.id) return;
    (async () => {
      const data = await fetchJson('https://api.githubcopilot.com/meta', { headers: { 'Accept': 'application/json' } });
      sendResponse({ ok: true, data });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
