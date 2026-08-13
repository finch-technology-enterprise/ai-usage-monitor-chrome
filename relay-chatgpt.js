(() => {
  if (globalThis.__aiUsageChatGptRelayInstalled) return;
  globalThis.__aiUsageChatGptRelayInstalled = true;

  function findAccessToken(value, depth = 0) {
    if (!value || depth > 6) return null;
    if (typeof value === 'string') return value.startsWith('eyJ') && value.split('.').length >= 2 ? value : null;
    if (Array.isArray(value)) {
      for (const v of value) { const found = findAccessToken(v, depth + 1); if (found) return found; }
    } else if (typeof value === 'object') {
      for (const key of ['accessToken', 'access_token', 'token']) {
        if (typeof value[key] === 'string' && value[key]) return value[key];
      }
      for (const v of Object.values(value)) { const found = findAccessToken(v, depth + 1); if (found) return found; }
    }
    return null;
  }

  function decodeJwtPayload(token) {
    try {
      const part = token.split('.')[1];
      const normalized = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
      return JSON.parse(atob(normalized));
    } catch { return {}; }
  }

  function findAccountId(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 7) return null;
    for (const key of ['chatgpt_account_id', 'chatgptAccountId', 'account_id', 'accountId']) {
      if (typeof value[key] === 'string' && value[key]) return value[key];
    }
    for (const v of Object.values(value)) {
      const found = findAccountId(v, depth + 1);
      if (found) return found;
    }
    return null;
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, { ...options, credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'AI_USAGE_CHATGPT') return;
    if (sender?.id !== chrome.runtime.id) return;
    (async () => {
      const session = await fetchJson('/api/auth/session', { headers: { 'Accept': 'application/json' } });
      const token = findAccessToken(session);
      if (!token) throw new Error('No access token in ChatGPT session');
      const accountId = findAccountId(session) || findAccountId(decodeJwtPayload(token));
      const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };
      if (accountId) headers['ChatGPT-Account-Id'] = accountId;
      const usage = await fetchJson('/backend-api/wham/usage', { headers });
      sendResponse({ ok: true, data: usage });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
