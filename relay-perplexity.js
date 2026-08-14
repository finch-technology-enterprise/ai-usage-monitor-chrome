(() => {
  if (globalThis.__aiUsagePerplexityRelayInstalled) return;
  globalThis.__aiUsagePerplexityRelayInstalled = true;

  // Same endpoints as directPerplexityUsage() in providers/perplexity.js
  // (consistency between the direct and relay paths). The quota endpoint
  // (/rest/rate-limit/all) is authoritative; the settings endpoint only
  // supplies the plan tier and its failure must not fail the quota reply.

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, { ...options, credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function fetchUsage() {
    const [quota, settings] = await Promise.allSettled([
      fetchJson('https://www.perplexity.ai/rest/rate-limit/all', { headers: { 'Accept': 'application/json' } }),
      fetchJson('https://www.perplexity.ai/rest/user/settings', { headers: { 'Accept': 'application/json' } })
    ]);
    if (quota.status !== 'fulfilled') throw quota.reason;
    return { quota: quota.value, settings: settings.status === 'fulfilled' ? settings.value : null };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'AI_USAGE_PERPLEXITY') return;
    if (sender?.id !== chrome.runtime.id) return;
    fetchUsage()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
