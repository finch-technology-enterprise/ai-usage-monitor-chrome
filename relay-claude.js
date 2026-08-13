(() => {
  if (globalThis.__aiUsageClaudeRelayInstalled) return;
  globalThis.__aiUsageClaudeRelayInstalled = true;

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

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, { ...options, credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'AI_USAGE_CLAUDE') return;
    if (sender?.id !== chrome.runtime.id) return;
    (async () => {
      const orgs = await fetchJson('/api/organizations');
      const ids = [...collectOrgIds(orgs)];
      let lastError = null;
      for (const id of ids) {
        try {
          const usage = await fetchJson(`/api/organizations/${encodeURIComponent(id)}/usage`, {
            headers: { 'anthropic-client-platform': 'web_claude_ai', 'Accept': 'application/json' }
          });
          sendResponse({ ok: true, data: usage });
          return;
        } catch (error) { lastError = error; }
      }
      throw lastError || new Error('No Claude organization returned usage');
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
