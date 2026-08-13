if (globalThis.__aiUsagePerplexityRelayInstalled) return;
globalThis.__aiUsagePerplexityRelayInstalled = true;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'AI_USAGE_PERPLEXITY') return;
  sendResponse({ ok: false, error: 'Usage endpoint not implemented yet' });
  return false;
});
