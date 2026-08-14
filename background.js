const POPUP_URL = chrome.runtime.getURL('popup.html');
const WINDOW_KEY = 'popupWindowId';
const TAB_KEY = 'popupTabId';
const DISMISS_KEY = 'dismissWindowId';
const VIEW_KEY = 'viewMode';
const VIEW_MODES = ['window', 'dismissable', 'tab'];
const DEFAULT_VIEW = 'window';

let inFlight = null;

async function getViewMode() {
  const { [VIEW_KEY]: mode } = await chrome.storage.local.get(VIEW_KEY);
  return VIEW_MODES.includes(mode) ? mode : DEFAULT_VIEW;
}

async function setViewMode(mode) {
  await chrome.storage.local.set({ [VIEW_KEY]: mode });
}

// Pings the tracked tab; only our popup.html page answers, so this tells us
// whether the tab is still ours or the user navigated it somewhere else.
async function isPopupTab(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'AI_USAGE_PING' });
    return response?.ok === true;
  } catch {
    return false;
  }
}

async function focusOrCreateWindow() {
  const { [WINDOW_KEY]: storedId } = await chrome.storage.session.get(WINDOW_KEY);
  if (storedId != null) {
    try {
      const win = await chrome.windows.get(storedId);
      if (win) {
        await chrome.windows.update(storedId, { focused: true });
        return { id: win.id, created: false };
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
  return { id: win.id, created: true };
}

async function focusOrCreateTab() {
  const { [TAB_KEY]: storedId } = await chrome.storage.session.get(TAB_KEY);
  if (storedId != null) {
    if (await isPopupTab(storedId)) {
      try {
        const tab = await chrome.tabs.get(storedId);
        await chrome.tabs.update(storedId, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        return;
      } catch { /* tab or window no longer exists */ }
    }
    await chrome.storage.session.remove(TAB_KEY);
  }
  const tab = await chrome.tabs.create({ url: POPUP_URL });
  await chrome.storage.session.set({ [TAB_KEY]: tab.id });
}

async function closeTrackedTab() {
  const { [TAB_KEY]: tabId } = await chrome.storage.session.get(TAB_KEY);
  if (tabId == null) return;
  await chrome.storage.session.remove(TAB_KEY);
  if (!(await isPopupTab(tabId))) return; // user navigated it elsewhere — leave it
  try {
    await chrome.tabs.remove(tabId);
  } catch { /* tab no longer exists */ }
}

async function openView(mode) {
  if (!VIEW_MODES.includes(mode)) mode = DEFAULT_VIEW;
  await setViewMode(mode);

  if (mode === 'tab') {
    const { [WINDOW_KEY]: winId } = await chrome.storage.session.get(WINDOW_KEY);
    await chrome.storage.session.remove([WINDOW_KEY, DISMISS_KEY]);
    if (winId != null) {
      try { await chrome.windows.remove(winId); } catch { /* window no longer exists */ }
    }
    return focusOrCreateTab();
  }

  const { [TAB_KEY]: tabId } = await chrome.storage.session.get(TAB_KEY);
  if (tabId != null) await closeTrackedTab();
  const { id, created } = await focusOrCreateWindow();
  if (mode === 'window' || created) {
    // A freshly created window is armed when it first gains focus (below);
    // an existing one is already settled, so arm it right away.
    await chrome.storage.session.remove(DISMISS_KEY);
  } else {
    await chrome.storage.session.set({ [DISMISS_KEY]: id });
  }
  return id;
}

// Dismissable view: close the popup window whenever focus moves elsewhere.
// A newly created window is only armed once it reports focus itself, so the
// transient focus events during creation can never close it prematurely.
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  const mode = await getViewMode();
  if (mode !== 'dismissable') return;
  const { [WINDOW_KEY]: popupId } = await chrome.storage.session.get(WINDOW_KEY);
  if (windowId === popupId) {
    await chrome.storage.session.set({ [DISMISS_KEY]: popupId });
    return;
  }
  const { [DISMISS_KEY]: dismissId } = await chrome.storage.session.get(DISMISS_KEY);
  if (dismissId == null) return;
  await chrome.storage.session.remove(DISMISS_KEY);
  try { await chrome.windows.remove(dismissId); } catch { /* already closed */ }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'AI_USAGE_SET_VIEW') {
    openView(message.mode)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'AI_USAGE_PING') {
    sendResponse({ ok: true });
  }
});

function handleClick() {
  if (!inFlight) {
    inFlight = (async () => {
      const mode = await getViewMode();
      await openView(mode);
    })().finally(() => { inFlight = null; });
  }
  return inFlight;
}

chrome.action.onClicked.addListener(handleClick);

chrome.windows.onRemoved.addListener(async (windowId) => {
  const { [WINDOW_KEY]: storedId } = await chrome.storage.session.get(WINDOW_KEY);
  if (storedId === windowId) await chrome.storage.session.remove(WINDOW_KEY);
  const { [DISMISS_KEY]: dismissId } = await chrome.storage.session.get(DISMISS_KEY);
  if (dismissId === windowId) await chrome.storage.session.remove(DISMISS_KEY);
});
