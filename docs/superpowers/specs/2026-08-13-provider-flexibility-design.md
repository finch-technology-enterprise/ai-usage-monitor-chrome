# Provider Flexibility: Toggles + New Providers — Design Spec

Date: 2026-08-13
Status: Approved (design gate) → pending spec review

## Problem

The extension hardcodes three providers (OpenCode, Claude, ChatGPT/Codex) across
`popup.html`, `popup.js`, and `manifest.json`. Not everyone subscribes to all
three, and users of other providers (Copilot, Gemini, Cursor, Perplexity,
Mistral, Grok) cannot use the extension at all.

## Goals

- Users can enable/disable each provider from Settings; disabled providers are
  hidden from the popup entirely.
- Support nine providers: OpenCode, Claude, ChatGPT/Codex, GitHub Copilot,
  Google Gemini, Cursor, Perplexity, Mistral Le Chat, xAI Grok.
- Fresh installs start with **all providers disabled** and an empty-state
  popup pointing at Settings.
- Existing users upgrading keep their current three providers enabled (storage
  migration).
- Stay vanilla JS, no build system, no new dependencies.

## Architecture

### Provider registry (`providers.js`)

A single classic script (no modules, matching repo convention) defining:

```js
const AIUsageProviders = {
  list: [],            // registration order
  register(provider),  // adds { id, label, ... }
  enabled(),           // filters against stored prefs
};
```

Provider object shape:

```js
{
  id: 'opencode',            // storage key segment, must match manifest hosts
  label: 'OpenCode',
  plan: 'Go',                // static plan badge fallback (optional)
  needs: 'key' | 'session',  // drives Settings hint text
  refresh(silent),           // fetch + render card body; returns bool
  settingsHtml(),            // Settings section: toggle + config
  readSettings(),            // persist Settings form back to storage
}
```

Helper functions currently in `popup.js` (`escapeHtml`, `metricHtml`,
`clampPercent`, `errorHtml`, `jsonFetch`) move into `providers.js` so every
adapter can use them without duplication. `metricHtml`'s colored-bar logic
stays as-is.

### Adapters (`providers/*.js`)

One classic script per provider, registered via
`AIUsageProviders.register({...})` at load time:

| File | Provider | Auth model |
| --- | --- | --- |
| `providers/opencode.js` | OpenCode | stored API key |
| `providers/claude.js` | Claude | browser session + relay |
| `providers/chatgpt.js` | ChatGPT/Codex | browser session + relay |
| `providers/copilot.js` | GitHub Copilot | browser session (github.com) + relay |
| `providers/gemini.js` | Google Gemini | browser session + relay |
| `providers/cursor.js` | Cursor | browser session (cursor.com) + relay |
| `providers/perplexity.js` | Perplexity | browser session + relay |
| `providers/mistral.js` | Mistral Le Chat | browser session + relay |
| `providers/grok.js` | xAI Grok | browser session + relay |

Each adapter keeps its own defensive parser with alias chains (repo
convention: never DRY parser helpers across files). Session-based adapters
reuse the direct-fetch → `relayMessage` fallback pattern, but each adapter
owns its own copy of the relay helper or a shared one in `providers.js`
(shared helper allowed — it is generic message plumbing, not a parser).

Endpoint research happens during implementation. Known anchors:

- Copilot: `api.githubcopilot.com/meta` (verified auth-gated; exact shape
  unstable — fall back to relay, degrade to "not available").
- Cursor: `curl.cursorapi.com/usage` (community-known; verify shape).
- Gemini, Perplexity, Mistral, Grok: internal/undocumented; expected risk.

**Feasibility rule:** if an adapter cannot produce usage after a reasonable
implementation effort, it ships in a degraded state — card renders once, then
shows a compact "usage not available for this provider" message on refresh
instead of blocking or erroring loudly. A degraded adapter is better than a
missing one: the registry keeps the UI stable.

### Popup (`popup.html`, `popup.js`, `popup.css`)

- Static card sections are removed; the body is a `<div id="providers">`
  container. `popup.js` renders one card per enabled provider
  (`provider.refresh(true)` on first render) in registry order.
- `refreshAll()` iterates enabled providers only; the refresh button still
  spins while any are in flight.
- Empty state (no providers enabled): one hint line + "Open Settings" button.
- Plan badges remain static text per provider (existing behavior).

### Settings (`options.html`, `options.js`, `options.css`)

- One section per provider, each with: name, enable toggle, config input(s)
  (OpenCode API key only today), and a hint ("Uses your signed-in
  browser session for X", or "Stored key sent only to opencode.ai").
- `Save` persists `{ enabledProviders: { id: bool }, opencodeApiKey }` to
  `chrome.storage.local`.
- Toggles render immediately (no save needed to see popup effect); the
  API key still requires Save (unchanged behavior).

### Storage

```jsonc
{
  "enabledProviders": { "opencode": false, "claude": false, /* ... */ },
  "opencodeApiKey": "sk-…"
}
```

- Key: `enabledProviders`. Absent key (fresh install or old version) → all
  providers **disabled**.
- Migration: if `enabledProviders` is absent **and** `opencodeApiKey` exists
  (or the user has used the extension — proxy: an existing `opencodeApiKey`
  or non-default `updatedAt`), seed `{ opencode: true, claude: true,
  chatgpt: true }` so existing users see no behavior change on update.

### Manifest

- Host permissions added: `https://copilot.github.com/*`,
  `https://api.githubcopilot.com/*`, `https://gemini.google.com/*`,
  `https://cursor.com/*`, `https://curl.cursorapi.com/*`,
  `https://www.perplexity.ai/*`, `https://chat.mistral.ai/*`,
  `https://grok.com/*`.
- Content scripts added only for providers using a relay; one
  `relay-<id>.js` per provider, mirroring `relay-claude.js` /
  `relay-chatgpt.js` (same message contract `{ ok: true, data }` /
  `{ ok: false, error }`, same `globalThis.__aiUsage*RelayInstalled` guard).
- **This intentionally widens the AGENTS.md "don't widen permissions" rule.**
  The rule predates multi-provider support; it is superseded by this spec for
  host permissions only. `storage`/`cookies` permissions are unchanged.

## Out of scope

- Optional API keys for session-based providers (keyless by design).
- Badge/notification alerts at thresholds.
- Optional `chrome.storage.sync` — storage stays local per existing privacy
  wording.

## Docs

- README: provider list, setup table (what each needs), updated privacy
  section (host access list), troubleshooting entries for new providers.
- `about.html`: provider list updated.
- `popup.html`/`options.html` copy references "OpenCode Go" → "OpenCode" where
  it names the provider (Go is the plan badge).

## Testing (manual — no test framework in repo)

1. Fresh install (clear extension storage): popup shows empty state; Settings
   shows all nine toggles off.
2. Enable only OpenCode with key: one card, correct usage bars.
3. Enable Claude + ChatGPT signed in: cards render; disable one → card gone.
4. Upgrade path: install previous version, set key, update → OpenCode, Claude,
   ChatGPT remain enabled, new six stay off.
5. Each new provider signed in → card renders (or degraded "not available" —
   acceptable per feasibility rule); signed out → compact error + hint.
6. Colored usage bars and font sizing unchanged.
