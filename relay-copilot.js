if (globalThis.__aiUsageCopilotRelayInstalled) return;
globalThis.__aiUsageCopilotRelayInstalled = true;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'AI_USAGE_COPILOT') return;
  sendResponse({ ok: false, error: 'Usage endpoint not implemented yet' });
  return false;
});
