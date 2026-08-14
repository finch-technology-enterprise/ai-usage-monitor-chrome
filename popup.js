const $ = (id) => document.getElementById(id);

const VIEW_MODES = ['window', 'dismissable', 'tab'];
const DISMISS_GRACE_MS = 250;
let viewMode = 'window';
let dismissTimer = null;
let isPopupWindow = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'AI_USAGE_PING') sendResponse({ ok: true });
});

// The page lives in a popup window or a tab; the container never changes,
// and only a popup window may dismiss itself (a tab must never close on
// blur — switching browser tabs fires blur).
chrome.windows.getCurrent().then((win) => {
  isPopupWindow = win?.type === 'popup';
});

// Dismissable view: the page closes itself when the window loses focus
// (clicking another window or app). Grace period + hasFocus() guard absorb
// transient focus blips; the focus event cancels a pending close.
function armDismissClose() {
  if (!isPopupWindow || viewMode !== 'dismissable' || dismissTimer) return;
  dismissTimer = setTimeout(() => {
    dismissTimer = null;
    if (!document.hasFocus()) window.close();
  }, DISMISS_GRACE_MS);
}

window.addEventListener('blur', armDismissClose);
window.addEventListener('focus', () => {
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
});

async function initViewSwitcher() {
  const { viewMode: saved } = await chrome.storage.local.get('viewMode');
  viewMode = VIEW_MODES.includes(saved) ? saved : 'window';
  document.querySelectorAll('.view-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === viewMode);
  });
}

// Settings writes viewMode directly; keep an open page in sync so the
// switcher highlight and the dismiss behavior reflect the saved default.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.viewMode) return;
  const mode = changes.viewMode.newValue;
  if (VIEW_MODES.includes(mode)) viewMode = mode;
  if (viewMode !== 'dismissable' && dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  } else if (viewMode === 'dismissable' && !document.hasFocus()) {
    armDismissClose(); // adopted dismissable while already unfocused — dismiss
  }
  document.querySelectorAll('.view-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === viewMode);
  });
});

document.querySelector('.view-switcher').addEventListener('click', async (event) => {
  const btn = event.target.closest('.view-btn');
  if (!btn || btn.dataset.mode === viewMode) return;
  viewMode = btn.dataset.mode;
  document.querySelectorAll('.view-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === viewMode);
  });
  try {
    const response = await chrome.runtime.sendMessage({ type: 'AI_USAGE_SET_VIEW', mode: viewMode });
    if (!response?.ok) await initViewSwitcher();
  } catch {
    await initViewSwitcher();
  }
});

$('closeView').addEventListener('click', () => window.close());

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  chrome.windows.getCurrent().then((win) => {
    if (win?.type === 'popup') window.close();
  });
});

function providerCardHtml(p) {
  return `
    <section class="provider" id="card-${p.id}">
      <div class="provider-head">
        <div class="provider-title">
          <h2>${escapeHtml(p.label)}</h2>
          ${p.plan ? `<span id="card-${p.id}-plan" class="plan-badge">${escapeHtml(p.plan)}</span>` : ''}
        </div>
        ${p.openUrl ? `<button class="small-btn" data-open="${escapeHtml(p.openUrl)}">Open</button>` : ''}
      </div>
      <div id="card-${p.id}-body" class="body"><div class="loading">Loading…</div></div>
    </section>`;
}

let refreshing = false;

async function refreshAll(silent = false) {
  if (refreshing) return;
  refreshing = true;
  try {
    const prefs = await loadProviderPrefs();
    const providers = AIUsageProviders.enabledIds(prefs.enabled);
    const button = $('refreshAll');
    if (!silent && providers.length) {
      button.classList.add('spinning');
      button.disabled = true;
    }
    const results = await Promise.all(providers.map((p) => p.refresh(silent)));
    if (results.includes(true)) {
      $('updatedAt').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    if (!silent) {
      button.classList.remove('spinning');
      button.disabled = false;
    }
  } finally {
    refreshing = false;
  }
}

async function render() {
  const prefs = await loadProviderPrefs();
  const providers = AIUsageProviders.enabledIds(prefs.enabled);
  $('providers').innerHTML = providers.map(providerCardHtml).join('');
  $('emptyState').hidden = providers.length > 0;
  if (providers.length) await refreshAll(true);
}

$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('refreshAll').addEventListener('click', () => refreshAll(true));
$('emptySettings')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
// Cards render dynamically after load — delegate the Open buttons
document.querySelector('.shell').addEventListener('click', (event) => {
  const open = event.target.closest('[data-open]');
  if (open) chrome.tabs.create({ url: open.dataset.open });
});

render();
initViewSwitcher();
setInterval(() => { if (!document.hidden) refreshAll(true); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAll(true); });

async function fitWindowToContent() {
  const win = await chrome.windows.getCurrent();
  if (!win || win.state !== 'normal' || win.type !== 'popup') return;
  const shell = document.querySelector('.shell');
  const docHeight = Math.ceil(shell?.getBoundingClientRect().height || document.documentElement.scrollHeight);
  const frame = Math.max(0, (window.outerHeight || 0) - (window.innerHeight || 0));
  const target = {
    width: 400,
    height: Math.min(docHeight + frame, Math.floor(screen.availHeight))
  };
  if (win.width === target.width && win.height === target.height) return;
  try {
    await chrome.windows.update(win.id, target);
  } catch { /* bounds may be mid-drag; re-check on the next tick */ }
}

new ResizeObserver(() => fitWindowToContent()).observe(document.body);
setInterval(() => fitWindowToContent(), 500);
