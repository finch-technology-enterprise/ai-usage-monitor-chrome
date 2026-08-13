const POPUP_URL = chrome.runtime.getURL('popup.html');

chrome.action.onClicked.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: POPUP_URL });
  const existing = tabs.find((tab) => tab.windowId != null);
  if (existing) {
    await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.windows.create({
    url: POPUP_URL,
    type: 'popup',
    width: 400,
    height: 720
  });
});
