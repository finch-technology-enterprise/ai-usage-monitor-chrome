if (globalThis.__aiUsageMistralRelayInstalled) return;
globalThis.__aiUsageMistralRelayInstalled = true;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'AI_USAGE_MISTRAL') return;
  sendResponse({ ok: false, error: 'Usage endpoint not implemented yet' });
  return false;
});
