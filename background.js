const POPUP_URL = chrome.runtime.getURL('popup.html');
const WINDOW_KEY = 'popupWindowId';

let inFlight = null;

async function focusOrCreatePopup() {
  const { [WINDOW_KEY]: storedId } = await chrome.storage.session.get(WINDOW_KEY);
  if (storedId != null) {
    try {
      const win = await chrome.windows.get(storedId);
      if (win) {
        await chrome.windows.update(storedId, { focused: true });
        return;
      }
    } catch { /* window no longer exists */ }
    await chrome.storage.session.remove(WINDOW_KEY);
  }
  const win = await chrome.windows.create({
    url: POPUP_URL,
    type: 'popup',
    width: 400,
    height: 720
  });
  await chrome.storage.session.set({ [WINDOW_KEY]: win.id });
}

function handleClick() {
  if (!inFlight) inFlight = focusOrCreatePopup().finally(() => { inFlight = null; });
  return inFlight;
}

chrome.action.onClicked.addListener(handleClick);

chrome.windows.onRemoved.addListener(async (windowId) => {
  const { [WINDOW_KEY]: storedId } = await chrome.storage.session.get(WINDOW_KEY);
  if (storedId === windowId) await chrome.storage.session.remove(WINDOW_KEY);
});
