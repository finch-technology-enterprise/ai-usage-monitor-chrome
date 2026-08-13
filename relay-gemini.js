if (globalThis.__aiUsageGeminiRelayInstalled) return;
globalThis.__aiUsageGeminiRelayInstalled = true;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'AI_USAGE_GEMINI') return;
  sendResponse({ ok: false, error: 'Usage endpoint not implemented yet' });
  return false;
});
