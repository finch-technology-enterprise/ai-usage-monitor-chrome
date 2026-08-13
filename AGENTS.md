# AGENTS.md

Personal Chrome extension (Manifest V3) that shows quota usage for OpenCode Go, Claude, and ChatGPT/Codex. Plain vanilla JS — no build system, no package.json, no tests, no lint, not a git repo. See README.md for install and endpoint documentation.

## Working with this repo

- There is no build/test/lint step. Chrome loads the folder directly (`chrome://extensions` → Load unpacked). After editing, click **Reload** on the extension; content scripts (`relay-*.js`) additionally require refreshing the provider tab.
- `manifest.json` is the only wiring: `background.js` (service worker; toolbar click opens/focuses one standalone `popup.html` window, no `default_popup`), `options.html`+`options.js` (settings), content scripts `relay-claude.js` (claude.ai) and `relay-chatgpt.js` (chatgpt.com). Keep icons at `icons/icon{16,32,48,128}.png`.
- Permissions are intentionally narrow: `storage`, `cookies`, and host access only to `opencode.ai`, `claude.ai`, `chatgpt.com`. Don't widen them.

## Architecture: direct fetch → relay fallback

Each provider first tries to fetch usage directly from the extension context (popup.js:103, 165, 272). On failure it sends a message to an open provider tab (`relayMessage`, popup.js:178):

- `{ type: 'AI_USAGE_CLAUDE' }` → relay-claude.js
- `{ type: 'AI_USAGE_CHATGPT' }` → relay-chatgpt.js

The relay content scripts and popup.js must stay in sync: message type, request flow, and response shape `{ ok: true, data }` / `{ ok: false, error }`. Each relay guards re-install with `globalThis.__aiUsage*RelayInstalled` (SPAs re-inject content scripts).

## Conventions to preserve

- Parser helpers (`collectOrgIds`, `findAccessToken`, `findAccountId`, JWT decode) are intentionally duplicated in popup.js and the relay scripts — content scripts are isolated from popup context and there is no bundler. Do not "DRY" them into shared modules.
- The usage endpoints are internal and unstable. All adapters parse defensively with alias chains (e.g. `w.usageDollars ?? w.usage_dollars ?? w.used ?? w.usage`); keep that pattern when extending parsers. `toPercent` (popup.js:23) normalizes Claude's inconsistent 0..1 vs 0..100 scales.
- Claude usage requires the `anthropic-client-platform: web_claude_ai` header. ChatGPT requires a Bearer token from `/api/auth/session` plus `ChatGPT-Account-Id` when present.
- The only stored secret is `opencodeApiKey` in `chrome.storage.local` (options.js:15). Never store Claude/ChatGPT cookies or tokens.
