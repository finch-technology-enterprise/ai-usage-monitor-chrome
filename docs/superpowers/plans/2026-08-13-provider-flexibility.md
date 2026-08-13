# Provider Flexibility (Toggles + 6 New Providers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the extension provider-agnostic: per-provider enable toggles in Settings, dynamic popup rendering, and six new providers (Copilot, Gemini, Cursor, Perplexity, Mistral, Grok) alongside the existing three.

**Architecture:** A `providers.js` registry plus one adapter file per provider under `providers/`. `popup.js` renders cards from the registry (enabled only); `options.js` renders per-provider Settings sections from the same registry. Session-based adapters keep the direct-fetch → relay fallback pattern with per-provider `relay-*.js` content scripts. No bundler, no dependencies — classic scripts in load order.

**Tech Stack:** Vanilla JS (ES2022+), Chrome Extension Manifest V3, `chrome.storage.local`. No tests framework — every task verifies via `node --check` (syntax) + manual reload in Chrome.

**Spec:** `docs/superpowers/specs/2026-08-13-provider-flexibility-design.md`

## Global Constraints

- Plain vanilla JS, classic `<script>` tags, no build system, no package.json.
- No new permissions beyond `storage` + `cookies`; host_permissions DO widen (spec §Manifest) — this supersedes the old AGENTS.md rule.
- Parser helpers are intentionally duplicated per file (content scripts are isolated; no bundler). Do not DRY parsers across files.
- Defensive parsing with alias chains everywhere; `toPercent` normalizes 0..1 vs 0..100 scales.
- Response contract between popup and relays: `{ ok: true, data }` / `{ ok: false, error }`.
- Every relay guards re-injection with `globalThis.__aiUsage<Id>RelayInstalled`.
- Never store cookies or tokens in `chrome.storage` — only `opencodeApiKey`.
- `manifest.json` version must NOT be bumped (that happens at release time via `release.sh`).
- Fresh install: all providers disabled. Upgrade: existing users keep `opencode`, `claude`, `chatgpt` enabled (seed rule in Task 2).
- Feasibility rule (spec): an adapter that cannot produce usage ships degraded — a compact "usage not available" message, never a blocking error.
- Manual verification pattern: after editing, click Reload on the extension in `chrome://extensions`; content scripts additionally require refreshing the provider tab.

---

### Task 1: Shared helpers module (`providers.js`)

**Files:**
- Create: `providers.js`
- Modify: none yet (popup.js still works; helpers moved over and deleted from popup.js in Task 3)

**Interfaces:**
- Produces (globals, loaded before popup.js/adapter files via `<script>` tags):
  - `clampPercent(value) -> number|null`
  - `firstNumber(...values) -> number|null`
  - `toPercent(value) -> number|null`
  - `parseResetTarget(raw) -> number|null`
  - `resetText(raw) -> string`
  - `resetMeta(raw) -> string`
  - `money(value) -> string|null`
  - `metricHtml(label, percent, meta='', right=null) -> string` (includes colored-bar classes `bar-ok`/`bar-warn`/`bar-danger`)
  - `escapeHtml(value) -> string`
  - `errorHtml(message, action='') -> string`
  - `jsonFetch(url, options={}) -> Promise<json|null>` (10s timeout, JSON-parse-tolerant)
  - `relayMessage(hostPattern, message) -> Promise<data>` (throws 'Open the provider website…')
- These are copied verbatim from `popup.js:9-116` plus `popup.js:203-213` (`relayMessage`). Exports happen by declaring `function` at top level (classic script, global scope).

- [ ] **Step 1: Create `providers.js` with the moved helpers**

Copy these functions from `popup.js` exactly as they are today (no behavior change):
`clampPercent`, `firstNumber`, `toPercent`, `parseResetTarget`, `resetText`, `resetMeta`, `money`, `metricHtml`, `escapeHtml`, `errorHtml`, `jsonFetch`, `relayMessage`. Keep `ENDPOINTS` out of this file (each adapter owns its endpoints). Note: `relayMessage` uses `chrome.tabs` — fine, this script runs in the popup context.

- [ ] **Step 2: Syntax-check**

Run: `node --check providers.js`
Expected: exit 0, no output.

- [ ] **Step 3: Add script tag to `popup.html` head, before `popup.js`**

In `popup.html`, after the `<link rel="stylesheet" href="popup.css" />` line, add `<script src="providers.js"></script>` before the existing `<script src="popup.js"></script>` at the bottom of `<body>`.

- [ ] **Step 4: Manual smoke test**

Reload the extension, open the popup. Expected: identical to before (helpers are now defined twice — popup.js still has its own copies; harmless duplication for this task).

- [ ] **Step 5: Commit**

```bash
git add providers.js popup.html
git commit -m "Add shared provider helpers module"
```

---

### Task 2: Provider preferences + migration (`providers.js`)

**Files:**
- Modify: `providers.js` (append)

**Interfaces:**
- Produces:
  - `const DEFAULT_ENABLED = ['opencode', 'claude', 'chatgpt']`
  - `loadProviderPrefs() -> Promise<{ enabled: Set<string> }>` — reads `chrome.storage.local`, applies the migration rule.
  - Migration rule (spec §Storage): if `enabledProviders` key is absent AND `opencodeApiKey` exists in storage → seed `{ opencode: true, claude: true, chatgpt: true }` and write it back. Otherwise absent key means all disabled.

- [ ] **Step 1: Write the function**

```js
const DEFAULT_ENABLED = ['opencode', 'claude', 'chatgpt'];

async function loadProviderPrefs() {
  const stored = await chrome.storage.local.get(['enabledProviders', 'opencodeApiKey']);
  let map = stored.enabledProviders;
  if (map == null) {
    map = stored.opencodeApiKey ? Object.fromEntries(DEFAULT_ENABLED.map((id) => [id, true])) : {};
    await chrome.storage.local.set({ enabledProviders: map });
  }
  return { enabled: new Set(Object.entries(map).filter(([, v]) => v).map(([id]) => id)) };
}
```

- [ ] **Step 2: Syntax-check**

Run: `node --check providers.js`
Expected: exit 0.

- [ ] **Step 3: Manual test of both branches**

With a key set in Settings (so `opencodeApiKey` exists): delete the `enabledProviders` key via `chrome://extensions` → service worker console (`chrome.storage.local.remove('enabledProviders')`), reload popup — all three cards still render. Then remove `opencodeApiKey` too and repeat — popup should now show only the empty state (built in Task 5; until then, zero cards render and refresh does nothing — acceptable mid-plan).

- [ ] **Step 4: Commit**

```bash
git add providers.js
git commit -m "Add provider preference loading with upgrade migration"
```

---

### Task 3: Registry + refactor existing three providers into adapters

**Files:**
- Create: `providers/opencode.js`, `providers/claude.js`, `providers/chatgpt.js`
- Modify: `providers.js` (append registry), `popup.html`, `popup.js`, `popup.css`

**Interfaces:**
- Produces:
  - `AIUsageProviders` global:
    - `AIUsageProviders.register(provider)` — validates `id`/`label`/`refresh`; appends to `list`; sets `provider.id`.
    - `AIUsageProviders.list` — array in registration order.
    - `AIUsageProviders.enabledIds(ids: Set<string>)` — filters list by the Set.
  - Provider shape: `{ id, label, plan, needs: 'key'|'session', refresh(silent) -> Promise<bool>, settingsHtml() -> string, readSettings() -> Promise<void> }`
- Consumes: all helpers from Task 1, `loadProviderPrefs` from Task 2.
- `popup.js` contract change: it now calls `AIUsageProviders.enabledIds(prefs.enabled)` and for each provider renders the card skeleton, then `provider.refresh(true)`.

- [ ] **Step 1: Add the registry to `providers.js`**

```js
const AIUsageProviders = {
  list: [],
  register(provider) {
    if (!provider?.id || !provider.label || typeof provider.refresh !== 'function') {
      throw new Error(`Invalid provider registration: ${provider?.id}`);
    }
    this.list.push(provider);
  },
  enabledIds(ids) {
    return this.list.filter((p) => ids.has(p.id));
  }
};
```

- [ ] **Step 2: Create `providers/opencode.js`**

Move `refreshOpenCode` from `popup.js:118-160` into a provider object, renaming internals as needed:

```js
AIUsageProviders.register({
  id: 'opencode',
  label: 'OpenCode',
  plan: 'Go',
  needs: 'key',
  async refresh(silent) {
    const body = document.getElementById(`card-${this.id}-body`);
    if (!body) return false;
    // body of the old refreshOpenCode, minus the body lookup, using global jsonFetch/errorHtml/firstNumber/clampPercent/resetMeta/money/metricHtml/escapeHtml
  },
  settingsHtml() {
    return `
      <label for="cfg-opencode-key">API key</label>
      <div class="input-row">
        <input id="cfg-opencode-key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-…" />
        <button type="button" id="cfg-opencode-toggle">Show</button>
      </div>
      <p class="help">Stored with <code>chrome.storage.local</code> in your Chrome profile. It is only sent to <code>https://opencode.ai/zen/go/v1/usage</code>.</p>`;
  },
  async readSettings() {
    const key = document.getElementById('cfg-opencode-key').value.trim();
    await chrome.storage.local.set({ opencodeApiKey: key });
  }
});
```

Include the `ENDPOINTS.opencode` value inline as `'https://opencode.ai/zen/go/v1/usage'`. Keep the exact defensive parsing and error messages from the current `refreshOpenCode`.

- [ ] **Step 3: Create `providers/claude.js`**

Move from `popup.js`: `getClaudeOrgFromCookie`, `collectOrgIds`, `directClaudeUsage`, `claudeUsageHtml`, `refreshClaude` (lines 162-261). Register as `{ id: 'claude', label: 'Claude', plan: 'Team / subscription', needs: 'session' }`. Endpoint `'https://claude.ai'`. `refresh()` = old `refreshClaude` (uses `relayMessage('https://claude.ai/*', { type: 'AI_USAGE_CLAUDE' })`). `settingsHtml()` returns the browser-session help copy from `options.html:24-27`. `readSettings()` = no-op. Keep `cachedClaudeOrgId` module-level variable.

- [ ] **Step 4: Create `providers/chatgpt.js`**

Move from `popup.js`: `findAccessToken`, `decodeJwtPayload`, `findAccountId`, `directChatGptUsage`, `chatGptUsageHtml`, `refreshChatGpt` (lines 263-356). Register as `{ id: 'chatgpt', label: 'ChatGPT / Codex', plan: 'Plus', needs: 'session' }`. Endpoint `'https://chatgpt.com'`. `refresh()` = old `refreshChatGpt` (relay `https://chatgpt.com/*`, type `AI_USAGE_CHATGPT`), including the `chatgptPlan` badge update — change the badge lookup from `$('chatgptPlan')` to `document.getElementById('card-chatgpt-plan')` (card plan badge gets id `card-${id}-plan`). `settingsHtml()` = session help copy. `readSettings()` = no-op.

- [ ] **Step 5: Rewrite `popup.html` to render dynamically**

Replace the three `<section class="provider">…</section>` blocks (lines 19-50) with:

```html
<main class="shell">
  <header class="topbar"> …unchanged… </header>
  <div id="providers"></div>
  <div id="emptyState" class="empty" hidden>
    <p>No providers enabled.</p>
    <button id="emptySettings" class="small-btn">Open Settings</button>
  </div>
  <footer> …unchanged… </footer>
```

- [ ] **Step 6: Rewrite `popup.js` as a thin renderer**

```js
const $ = (id) => document.getElementById(id);

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
```

Keep `fitWindowToContent` and the `[data-open]` handler wiring unchanged (the Open buttons in cards were removed — restore them via `data-open` attribute in `providerCardHtml` when the provider defines `openUrl`; set `openUrl` on each of the three adapters: opencode.ai, claude.ai/settings/usage, chatgpt.com/#usage). Delete all moved helper functions and provider logic from `popup.js`.

- [ ] **Step 7: Add `.empty` styling to `popup.css`**

```css
.empty { text-align: center; color: var(--muted); padding: 24px 0 8px; font-size: 13px; }
.empty .small-btn { margin-top: 10px; }
```

- [ ] **Step 8: Syntax-check and manual test**

Run: `node --check providers.js && node --check popup.js && node --check providers/opencode.js && node --check providers/claude.js && node --check providers/chatgpt.js`
Expected: all exit 0.

Reload extension; with existing key + sessions: all three cards render with Open/buttons, colored bars, refresh works, autofit window still sizes correctly. Test the fallback path: sign out of one session, card shows compact error.

- [ ] **Step 9: Commit**

```bash
git add providers.js popup.js popup.html popup.css providers/
git commit -m "Refactor providers into registry-driven adapters"
```

---

### Task 4: Settings page with provider toggles

**Files:**
- Modify: `options.html`, `options.js`, `options.css`
- Modify: `popup.html` (add `providers.js` script tag before `options`? No — options page needs its own script include; see Step 2)

**Interfaces:**
- Consumes: `AIUsageProviders` (via a `providers.js` script tag in `options.html`), `loadProviderPrefs`, provider `.settingsHtml()` / `.readSettings()`.
- Produces: `enabledProviders` map written to `chrome.storage.local`; Options UI with one section per provider.

- [ ] **Step 1: `options.html` — dynamic provider list**

Add `<script src="providers.js"></script>` before `<script src="options.js"></script>`. Replace the static OpenCode section and the "Browser sessions" section with:

```html
<div id="providerSettings"></div>
<div class="actions">
  <button id="save" class="primary">Save</button>
  <span id="status"></span>
</div>
```

- [ ] **Step 2: `options.js` — render toggles, persist**

```js
async function render() {
  const prefs = await loadProviderPrefs();
  const container = document.getElementById('providerSettings');
  container.innerHTML = AIUsageProviders.list.map((p) => `
    <section class="provider-setting">
      <h2>${escapeHtml(p.label)}</h2>
      <label class="toggle-row">
        <input type="checkbox" id="en-${p.id}" ${prefs.enabled.has(p.id) ? 'checked' : ''} />
        <span>Enable ${escapeHtml(p.label)}</span>
      </label>
      <div class="config">${p.settingsHtml()}</div>
    </section>
  `).join('');
  const { opencodeApiKey = '' } = await chrome.storage.local.get('opencodeApiKey');
  const keyInput = document.getElementById('cfg-opencode-key');
  if (keyInput) keyInput.value = opencodeApiKey;
}

document.getElementById('save').addEventListener('click', async () => {
  const prefs = await loadProviderPrefs();
  const map = Object.fromEntries(AIUsageProviders.list.map((p) => [
    p.id,
    document.getElementById(`en-${p.id}`).checked
  ]));
  await chrome.storage.local.set({ enabledProviders: map });
  for (const p of AIUsageProviders.list) await p.readSettings();
  const status = document.getElementById('status');
  status.textContent = 'Saved.';
  setTimeout(() => { status.textContent = ''; }, 1500);
});

render();
```

Delete the old OpenCode key wiring from `options.js` (the key input now lives in the OpenCode adapter's `settingsHtml()`). Keep the show/hide behavior with a delegated click handler:

```js
document.getElementById('providerSettings').addEventListener('click', (event) => {
  if (event.target.id !== 'cfg-opencode-toggle') return;
  const input = document.getElementById('cfg-opencode-key');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  event.target.textContent = show ? 'Hide' : 'Show';
});
```

- [ ] **Step 3: `options.css` — toggle styling**

```css
.provider-setting { margin-bottom: 20px; }
.toggle-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; cursor: pointer; }
.toggle-row input { width: 16px; height: 16px; accent-color: var(--fill); }
.config .help { margin-top: 4px; }
```

Match existing variable names in `options.css` — read it first; if it has no `--fill`, add `accent-color: #1e2228`.

- [ ] **Step 4: Syntax-check + manual test**

Run: `node --check options.js`
Expected: exit 0.

Reload extension → right-click → Options: nine sections, each with a checkbox (state matches popup), OpenCode shows the key field prefilled. Toggle Claude off, Save → popup shows only OpenCode + ChatGPT cards. Toggle all off → popup shows the empty state (from Task 5 if landed; otherwise zero cards).

- [ ] **Step 5: Commit**

```bash
git add options.html options.js options.css
git commit -m "Add per-provider enable toggles to Settings"
```

---

### Task 5: Popup empty state polish

**Files:**
- Modify: `popup.html`, `popup.css`, `popup.js`

(Registry and renderer already handle zero providers from Task 3; this task verifies and polishes.)

- [ ] **Step 1: Verify behavior**

With all providers disabled: popup shows "No providers enabled." + Open Settings button; `refreshAll` skips work; `updatedAt` untouched. If Task 3's code already handles this, fix any gaps (e.g. the refresh button should not spin with zero providers).

- [ ] **Step 2: Syntax-check + manual test**

Run: `node --check popup.js`
Toggle all off, reload, confirm empty state and that the window still sizes correctly. Clicking Open Settings opens Options.

- [ ] **Step 3: Commit**

```bash
git add popup.html popup.css popup.js
git commit -m "Polish popup empty state"
```

---

### Task 6: Manifest widening + relay scaffolding

**Files:**
- Modify: `manifest.json`
- Create: `relay-copilot.js`, `relay-gemini.js`, `relay-cursor.js`, `relay-perplexity.js`, `relay-mistral.js`, `relay-grok.js`

**Interfaces:**
- Consumes: existing relay contract (`{ ok: true, data }` / `{ ok: false, error }`, `globalThis` re-injection guard) from `relay-claude.js`.
- Produces: one generic relay script per new provider. Each new relay initially returns `{ ok: false, error: 'Usage endpoint not implemented yet' }` so the popup falls through to its own logic; Task 7-12 fill them in.

- [ ] **Step 1: Add host permissions to `manifest.json`**

Append to `host_permissions`:

```json
"https://copilot.github.com/*",
"https://api.githubcopilot.com/*",
"https://gemini.google.com/*",
"https://cursor.com/*",
"https://curl.cursorapi.com/*",
"https://www.perplexity.ai/*",
"https://chat.mistral.ai/*",
"https://grok.com/*"
```

- [ ] **Step 2: Add content script entries to `manifest.json`**

One entry per new provider, matching `relay-claude.js`'s shape, e.g.:

```json
{ "matches": ["https://copilot.github.com/*", "https://github.com/*"], "js": ["relay-copilot.js"], "run_at": "document_idle" },
{ "matches": ["https://gemini.google.com/*"], "js": ["relay-gemini.js"], "run_at": "document_idle" },
{ "matches": ["https://cursor.com/*"], "js": ["relay-cursor.js"], "run_at": "document_idle" },
{ "matches": ["https://www.perplexity.ai/*"], "js": ["relay-perplexity.js"], "run_at": "document_idle" },
{ "matches": ["https://chat.mistral.ai/*"], "js": ["relay-mistral.js"], "run_at": "document_idle" },
{ "matches": ["https://grok.com/*"], "js": ["relay-grok.js"], "run_at": "document_idle" }
```

- [ ] **Step 3: Write the six relay skeletons**

Each file follows this exact pattern (replace `copilot`/`COPILOT` and the message type per provider):

```js
if (globalThis.__aiUsageCopilotRelayInstalled) return;
globalThis.__aiUsageCopilotRelayInstalled = true;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'AI_USAGE_COPILOT') return;
  sendResponse({ ok: false, error: 'Usage endpoint not implemented yet' });
  return false;
});
```

Message types: `AI_USAGE_COPILOT`, `AI_USAGE_GEMINI`, `AI_USAGE_CURSOR`, `AI_USAGE_PERPLEXITY`, `AI_USAGE_MISTRAL`, `AI_USAGE_GROK`.

- [ ] **Step 4: Syntax-check + reload test**

Run: `node --check relay-copilot.js relay-gemini.js relay-cursor.js relay-perplexity.js relay-mistral.js relay-grok.js && node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"`
Expected: all exit 0. Reload extension; existing providers unaffected.

- [ ] **Step 5: Commit**

```bash
git add manifest.json relay-copilot.js relay-gemini.js relay-cursor.js relay-perplexity.js relay-mistral.js relay-grok.js
git commit -m "Widen host permissions and scaffold new provider relays"
```

---

### Task 7: Copilot adapter

**Files:**
- Create: `providers/copilot.js`
- Modify: `relay-copilot.js`, `popup.html` (script tag)

**Interfaces:**
- Consumes: `AIUsageProviders`, helpers from `providers.js`, relay contract `{ type: 'AI_USAGE_COPILOT' }` on `https://copilot.github.com/*` + `https://github.com/*`.
- Produces: registered provider `{ id: 'copilot', label: 'GitHub Copilot', plan: '…', needs: 'session', openUrl: 'https://copilot.github.com' }`.

- [ ] **Step 1: Research the endpoint**

Probe with curl (a token is required; expected to fail without auth — that failure still documents the path):
`curl -s -m 10 https://api.githubcopilot.com/meta` — inspect the JSON shape (`rate_limit.usage`, `rate_limit.allowed`, `rate_limit.reset_date`). If 404, check community documentation for the current endpoint (e.g. via the opencode.ai docs index or `copilot.ai`). Record the response shape in a comment at the top of the adapter.

- [ ] **Step 2: Write `providers/copilot.js`**

Session-based adapter following the Claude pattern: direct `jsonFetch` of the usage URL with `credentials: 'include'`; on failure `relayMessage('https://copilot.github.com/*', { type: 'AI_USAGE_COPILOT' })`. Parse defensively:

```js
const usage = data?.rate_limit ?? data?.usage ?? data;
const pct = toPercent(firstNumber(usage?.usage_percent, usage?.used_percent, usage?.utilization, usage?.percent,
  (usage?.usage != null && usage?.allowed) ? (usage.usage / usage.allowed) * 100 : null));
const reset = resetMeta(usage?.reset_date ?? usage?.reset_at ?? usage?.resets_at);
```

Render via `metricHtml('Copilot usage', pct, reset, detail)` with `detail = used/allowed` when available. On repeated failure, fall back to `errorHtml('usage not available for this provider', …)` — this is the spec's degraded state, not a crash.

- [ ] **Step 3: Implement `relay-copilot.js`**

Fetch from the page context with the page's own cookies (`fetch(url, { credentials: 'include' })`), return `{ ok: true, data }` on success, `{ ok: false, error }` on failure. Keep the re-injection guard.

- [ ] **Step 4: Wire script tags**

Add `<script src="providers/copilot.js"></script>` to `popup.html` **and** `options.html`, before `popup.js`/`options.js` respectively (after `providers.js`).

- [ ] **Step 5: Syntax-check + manual test**

Run: `node --check providers/copilot.js relay-copilot.js`
Sign in to github.com in the same profile, enable Copilot in Settings, reload popup: card renders with a percentage + reset line, or the degraded "not available" message (acceptable). With Copilot not signed in: compact error + hint.

- [ ] **Step 6: Commit**

```bash
git add providers/copilot.js relay-copilot.js popup.html options.html
git commit -m "Add GitHub Copilot provider adapter"
```

---

### Task 8: Gemini adapter

**Files:**
- Create: `providers/gemini.js`
- Modify: `relay-gemini.js`, `popup.html`, `options.html`

**Interfaces:**
- Consumes: registry + helpers; relay `AI_USAGE_GEMINI` on `https://gemini.google.com/*`.
- Produces: `{ id: 'gemini', label: 'Google Gemini', plan: '…', needs: 'session', openUrl: 'https://gemini.google.com' }`.

- [ ] **Step 1: Research the endpoint**

Gemini's usage endpoint is internal and undocumented. Try in a signed-in browser: DevTools → Network on gemini.google.com, find the XHR that returns quota/usage on the settings or home page. If no stable endpoint exists after 30 minutes of effort, ship the degraded adapter (Step 2 with a `NOT_AVAILABLE` flag).

- [ ] **Step 2: Write `providers/gemini.js` + `relay-gemini.js`**

Same session-adapter pattern as Task 7. If research found no endpoint: `refresh()` renders `errorHtml('Usage not available for Google Gemini yet.', 'Your signed-in Gemini session is used; the endpoint may appear in a future update.')` and returns false — degraded state per spec.

- [ ] **Step 3: Wire script tags** (same as Task 7 Step 4)

- [ ] **Step 4: Syntax-check + manual test**

Run: `node --check providers/gemini.js relay-gemini.js`
Expected: card renders or degrades cleanly; no console errors; other providers unaffected.

- [ ] **Step 5: Commit**

```bash
git add providers/gemini.js relay-gemini.js popup.html options.html
git commit -m "Add Gemini provider adapter"
```

---

### Task 9: Cursor adapter

**Files:**
- Create: `providers/cursor.js`
- Modify: `relay-cursor.js`, `popup.html`, `options.html`

**Interfaces:**
- Consumes: registry + helpers; relay `AI_USAGE_CURSOR` on `https://cursor.com/*`.
- Produces: `{ id: 'cursor', label: 'Cursor', plan: '…', needs: 'session', openUrl: 'https://cursor.com/settings' }`.

- [ ] **Step 1: Research the endpoint**

Probe `https://curl.cursorapi.com/usage` — community-documented; verify the JSON shape (`used`, `limit`, `max_usage_percentage`, `subscription.end_of_month`, …) by signing in to cursor.com in a profile and watching DevTools Network, or searching for the current shape.

- [ ] **Step 2: Write `providers/cursor.js` + `relay-cursor.js`**

Session adapter as in Task 7. Parse defensively:

```js
const pct = toPercent(firstNumber(w?.max_usage_percentage, w?.usage_percent, w?.utilization, w?.percent));
const used = firstNumber(w?.used, w?.usage);
const limit = firstNumber(w?.limit, w?.allowed, w?.quota);
const detail = used != null && limit != null ? `${used} / ${limit}` : '';
const reset = resetMeta(w?.end_of_month ?? w?.reset_at ?? w?.resets_at);
```

- [ ] **Step 3: Wire script tags** (same as Task 7 Step 4)

- [ ] **Step 4: Syntax-check + manual test**

Run: `node --check providers/cursor.js relay-cursor.js`
Sign in to cursor.com, enable Cursor, reload: card with usage bar; or degraded message.

- [ ] **Step 5: Commit**

```bash
git add providers/cursor.js relay-cursor.js popup.html options.html
git commit -m "Add Cursor provider adapter"
```

---

### Task 10: Perplexity adapter

**Files:**
- Create: `providers/perplexity.js`
- Modify: `relay-perplexity.js`, `popup.html`, `options.html`

**Interfaces:**
- Consumes: registry + helpers; relay `AI_USAGE_PERPLEXITY` on `https://www.perplexity.ai/*`.
- Produces: `{ id: 'perplexity', label: 'Perplexity', plan: '…', needs: 'session', openUrl: 'https://www.perplexity.ai/settings' }`.

- [ ] **Step 1: Research the endpoint**

Perplexity usage is exposed via internal `/rest/…` APIs on www.perplexity.ai (community-documented). Inspect DevTools Network in a signed-in session to find the quota call, or use community sources. Record the shape.

- [ ] **Step 2: Write `providers/perplexity.js` + `relay-perplexity.js`**

Session adapter as in Task 7, defensive parsing with alias chains; degraded fallback per spec if no endpoint is found.

- [ ] **Step 3: Wire script tags** (same as Task 7 Step 4)

- [ ] **Step 4: Syntax-check + manual test**

Run: `node --check providers/perplexity.js relay-perplexity.js`
Expected: card renders or degrades cleanly.

- [ ] **Step 5: Commit**

```bash
git add providers/perplexity.js relay-perplexity.js popup.html options.html
git commit -m "Add Perplexity provider adapter"
```

---

### Task 11: Mistral adapter

**Files:**
- Create: `providers/mistral.js`
- Modify: `relay-mistral.js`, `popup.html`, `options.html`

**Interfaces:**
- Consumes: registry + helpers; relay `AI_USAGE_MISTRAL` on `https://chat.mistral.ai/*`.
- Produces: `{ id: 'mistral', label: 'Mistral Le Chat', plan: '…', needs: 'session', openUrl: 'https://chat.mistral.ai' }`.

- [ ] **Step 1: Research the endpoint**

Le Chat usage: community sources point at internal `/api/…` endpoints on chat.mistral.ai. Inspect DevTools Network in a signed-in session; record the shape.

- [ ] **Step 2: Write `providers/mistral.js` + `relay-mistral.js`**

Session adapter as in Task 7, defensive parsing; degraded fallback per spec.

- [ ] **Step 3: Wire script tags** (same as Task 7 Step 4)

- [ ] **Step 4: Syntax-check + manual test**

Run: `node --check providers/mistral.js relay-mistral.js`
Expected: card renders or degrades cleanly.

- [ ] **Step 5: Commit**

```bash
git add providers/mistral.js relay-mistral.js popup.html options.html
git commit -m "Add Mistral Le Chat provider adapter"
```

---

### Task 12: Grok adapter

**Files:**
- Create: `providers/grok.js`
- Modify: `relay-grok.js`, `popup.html`, `options.html`

**Interfaces:**
- Consumes: registry + helpers; relay `AI_USAGE_GROK` on `https://grok.com/*`.
- Produces: `{ id: 'grok', label: 'xAI Grok', plan: '…', needs: 'session', openUrl: 'https://grok.com' }`.

- [ ] **Step 1: Research the endpoint**

Grok's usage is behind an obfuscated internal API. Inspect DevTools Network in a signed-in session; if no stable endpoint exists after a reasonable effort, ship degraded (spec feasibility rule).

- [ ] **Step 2: Write `providers/grok.js` + `relay-grok.js`**

Session adapter as in Task 7, defensive parsing; degraded fallback per spec.

- [ ] **Step 3: Wire script tags** (same as Task 7 Step 4)

- [ ] **Step 4: Syntax-check + manual test**

Run: `node --check providers/grok.js relay-grok.js`
Expected: card renders or degrades cleanly.

- [ ] **Step 5: Commit**

```bash
git add providers/grok.js relay-grok.js popup.html options.html
git commit -m "Add xAI Grok provider adapter"
```

---

### Task 13: Docs + conventions update

**Files:**
- Modify: `README.md`, `about.html`, `AGENTS.md`

- [ ] **Step 1: Update `README.md`**

- Provider list: nine providers with per-provider "what it needs" (API key vs signed-in session).
- Install steps: replace step 7 with "Right-click → Options, enable the providers you subscribe to, and paste your OpenCode Go API key if using OpenCode".
- Privacy section: update host-access wording to the full host list; keep "no analytics / no cookies copied" claims.
- Troubleshooting: add per-provider "says to open the provider website" entries for the six new providers; note Gemini/Grok may show "not available" if their internal endpoints are unreachable.

- [ ] **Step 2: Update `about.html`**

Read `about.html` first; update its provider list and description text to match. Any "OpenCode Go" copy that names the provider becomes "OpenCode" (Go remains the plan badge).

- [ ] **Step 3: Update `AGENTS.md`**

- Architecture section: describe `providers.js` registry, `providers/*.js` adapters, `relay-*.js` scripts; note the shared-helper duplication rule now applies to parsers only (registry + generic helpers like `jsonFetch`/`metricHtml` live in `providers.js`).
- Permissions paragraph: replace "Don't widen them" with the current host list and the rule that adding a provider means adding its hosts + relay.

- [ ] **Step 4: Final end-to-end pass**

`node --check` every `*.js` file in the repo root and `providers/`. Reload the extension. Verify: fresh-install empty state (clear storage), upgrade migration (seed key), all nine toggles in Settings, existing three providers render bars, disabled providers absent, refresh timer only fetches enabled providers.

- [ ] **Step 5: Commit**

```bash
git add README.md about.html AGENTS.md
git commit -m "Document multi-provider setup and conventions"
```
