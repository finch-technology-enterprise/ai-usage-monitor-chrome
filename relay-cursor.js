if (globalThis.__aiUsageCursorRelayInstalled) return;
globalThis.__aiUsageCursorRelayInstalled = true;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'AI_USAGE_CURSOR') return;
  sendResponse({ ok: false, error: 'Usage endpoint not implemented yet' });
  return false;
});
