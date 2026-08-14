const $ = (id) => document.getElementById(id);

const VIEW_MODES = ['window', 'dismissable', 'tab'];
let viewMode = 'window';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'AI_USAGE_PING') sendResponse({ ok: true });
});

async function initViewSwitcher() {
  const { viewMode: saved } = await chrome.storage.local.get('viewMode');
  viewMode = VIEW_MODES.includes(saved) ? saved : 'window';
  document.querySelectorAll('.view-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === viewMode);
  });
}

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
