if (globalThis.__aiUsageGrokRelayInstalled) return;
globalThis.__aiUsageGrokRelayInstalled = true;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'AI_USAGE_GROK') return;
  sendResponse({ ok: false, error: 'Usage endpoint not implemented yet' });
  return false;
});
