const POPUP_URL = chrome.runtime.getURL('popup.html');
const WINDOW_URL = `${POPUP_URL}?container=window`;
const TAB_URL = `${POPUP_URL}?container=tab`;
const WINDOW_KEY = 'popupWindowId';
const TAB_KEY = 'popupTabId';

// Pings the tracked tab; only our popup.html page answers, so this tells us
// whether the tab is still ours or the user navigated it somewhere else.
// A rejection can also mean the tab is still loading (no listener yet), so
// retry while the tab exists instead of declaring it foreign immediately.
async function isPopupTab(tabId) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'AI_USAGE_PING' });
      return response?.ok === true;
    } catch {
      let tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch {
        return false; // tab no longer exists
      }
      if (tab.status !== 'loading') return false; // loaded but has no listener — not ours
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return false;
}

async function focusOrCreateWindow() {
  const { [WINDOW_KEY]: storedId } = await chrome.storage.session.get(WINDOW_KEY);
  if (storedId != null) {
    try {
      const win = await chrome.windows.get(storedId);
      if (win && win.type === 'popup') {
        await chrome.windows.update(storedId, { focused: true });
        return;
      }
    } catch { /* window no longer exists */ }
    await chrome.storage.session.remove(WINDOW_KEY);
  }
  const win = await chrome.windows.create({
    url: WINDOW_URL,
    type: 'popup',
    width: 400,
    height: 720
  });
  await chrome.storage.session.set({ [WINDOW_KEY]: win.id });
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
  const tab = await chrome.tabs.create({ url: TAB_URL });
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

async function openWindow() {
  const { [TAB_KEY]: tabId } = await chrome.storage.session.get(TAB_KEY);
  if (tabId != null) await closeTrackedTab();
  return focusOrCreateWindow();
}

async function openTab() {
  const { [WINDOW_KEY]: winId } = await chrome.storage.session.get(WINDOW_KEY);
  await chrome.storage.session.remove(WINDOW_KEY);
  if (winId != null) {
    try { await chrome.windows.remove(winId); } catch { /* window no longer exists */ }
  }
  return focusOrCreateTab();
}

// View opens go through this single chain so rapid switches cannot
// interleave — e.g. a tab switch removing a window a window switch is
// about to focus.
let queue = Promise.resolve();

function enqueue(task) {
  const run = queue.then(task);
  queue = run.catch(() => { /* next task still runs */ });
  return run;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'AI_USAGE_OPEN_WINDOW' || message?.type === 'AI_USAGE_OPEN_TAB') {
    const task = message.type === 'AI_USAGE_OPEN_WINDOW' ? openWindow : openTab;
    enqueue(task)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'AI_USAGE_PING') {
    sendResponse({ ok: true });
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const { [WINDOW_KEY]: storedId } = await chrome.storage.session.get(WINDOW_KEY);
  if (storedId === windowId) await chrome.storage.session.remove(WINDOW_KEY);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { [TAB_KEY]: storedId } = await chrome.storage.session.get(TAB_KEY);
  if (storedId === tabId) await chrome.storage.session.remove(TAB_KEY);
});
