(() => {
  if (globalThis.__aiUsageMistralRelayInstalled) return;
  globalThis.__aiUsageMistralRelayInstalled = true;

  // Same endpoint as directMistralUsage() in providers/mistral.js (the tRPC
  // user.limits procedure). Helpers are duplicated here on purpose — content
  // scripts are isolated from the popup context and there is no bundler.

  function mistralAnonymousId() {
    if (!mistralAnonymousId.value) {
      mistralAnonymousId.value = Math.random().toString(36).slice(2, 8) || 'mistral';
    }
    return mistralAnonymousId.value;
  }

  function mistralLimitsUrl() {
    const input = JSON.stringify({ 0: { json: { stableAnonymousIdentifier: mistralAnonymousId() } } });
    return `https://chat.mistral.ai/api/trpc/user.limits?batch=1&input=${encodeURIComponent(input)}`;
  }

  function findMistralLimitsObject(value, depth = 0) {
    if (value == null || depth > 8 || typeof value !== 'object') return null;
    if (!Array.isArray(value)) {
      const entries = Object.entries(value);
      if (entries.some(([, v]) => v && typeof v === 'object' && Number.isFinite(Number(v?.remainingPoints ?? v?.remaining_points ?? v?.remaining)))) {
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

  // Local copy of the textFetch timeout pattern from providers.js — content
  // scripts are isolated from the popup context and there is no bundler.
  async function fetchLimitsText() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(mistralLimitsUrl(), {
        credentials: 'include',
        headers: {
          'Accept': 'application/jsonl',
          'trpc-accept': 'application/jsonl',
          'x-trpc-source': 'nextjs-react'
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchLimits() {
    const limits = parseMistralLimits(await fetchLimitsText());
    if (!limits) throw new Error('Unexpected Mistral limits response format');
    return limits;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'AI_USAGE_MISTRAL') return;
    if (sender?.id !== chrome.runtime.id) return;
    fetchLimits()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
