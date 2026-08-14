# AGENTS.md

Personal Chrome extension (Manifest V3) that shows quota usage for nine AI providers: OpenCode (API key), Claude, ChatGPT/Codex, GitHub Copilot, Google Gemini, Cursor, Perplexity, Mistral Le Chat, and xAI Grok (all signed-in session). Plain vanilla JS — no build system, no package.json, no tests, no lint. Git repo on GitHub (`main` is the default branch). See README.md for install and endpoint documentation.

## Working with this repo

- There is no build/test/lint step. Chrome loads the folder directly (`chrome://extensions` → Load unpacked). After editing, click **Reload** on the extension; content scripts (`relay-*.js`) additionally require refreshing the provider tab.
- Releasing: `bash release.sh vX.Y.Z` bumps `manifest.json` version from the tag, then `.github/workflows/publish.yml` zips the extension and uploads/publishes to the Chrome Web Store via `chrome-webstore-upload-cli` (GitHub secrets `CWS_*`). Store listing fields live in the Web Store dashboard, not the repo.
- `manifest.json` is the only wiring: `background.js` (service worker; handles the pop-out messages and tracks/reuses the open popup window and tab), `options.html`+`options.js` (settings), `popup.html`+`popup.js` (the monitor UI, shown as the native toolbar popup via `action.default_popup` and loaded in a popup window or tab for the pop-out views), `providers.js` + `providers/*.js` (loaded by both popup and options), and one `relay-*.js` content script per session-based provider (`relay-claude.js`, `relay-chatgpt.js`, `relay-copilot.js`, `relay-gemini.js`, `relay-cursor.js`, `relay-perplexity.js`, `relay-mistral.js`, `relay-grok.js`). OpenCode is key-based and has no relay. Keep icons at `icons/icon{16,32,48,128}.png`.
- Permissions are intentionally narrow: `storage`, `cookies`, plus `host_permissions` for the nine providers' hosts — `opencode.ai`, `claude.ai`, `chatgpt.com`, `copilot.github.com` and `api.githubcopilot.com`, `gemini.google.com`, `cursor.com`, `www.perplexity.ai`, `chat.mistral.ai`, `grok.com` (see `manifest.json`). Adding a provider means adding its hosts to `host_permissions` and, for session-based providers, a `relay-*.js` content script. Never add `<all_urls>`.

## Git workflow

0. **GitHub via MCP only — never `gh`.** All GitHub API operations — creating issues or PRs, listing branches, searching code, reviewing, commenting — must go through the `github-my-johnlee` MCP server (`github-my-johnlee_*` tools). Do **not** use the `gh` CLI for any of them. Local git commands (`git fetch`, `pull --rebase`, `merge --no-ff`, `push`, worktree/branch management) stay on the command line; the MCP server cannot run local git.
1. **Conventional Commits.** Every commit title is `<type>(<scope>): <summary>` — types: `feat`, `fix`, `docs`, `refactor`, `perf`, `style`, `test`, `build`, `ci`, `revert`. Imperative mood, lowercase, ≤72 chars, no trailing period. Body (blank line after title) explains *why*, wrapped at ~72 chars; bullet points for multiple changes. Rewriting is allowed: `rebase -i` to tidy a branch's commits, squash before merging. Force-push with `--force-with-lease` is allowed on **feature branches only — never on `main`**.
2. **Always branch from latest main into a worktree.** Before starting work: `git fetch origin`, then `git pull --rebase` on local `main` (in the root checkout — `main` can never be checked out in a worktree) so it's current, then create the branch and worktree from `main`. Work only inside `.worktrees/<branch>` — the root checkout is shared, and other agents may be running worktrees on this repo. Branch names: `feature/<slug>`, `hotfix/<slug>`, `chore/<slug>`, `docs/<slug>` (older branches like `provider-flexibility` predate this naming). During active development, don't run git commands that touch `main` or other worktrees' branches while another agent is active — the merge step below is the exception.
3. **Local PR flow.** When the work is done and verified, merge the branch into `main` with `git merge --no-ff <branch>` (keeps branch history with a merge commit as the PR record), push `main` to origin, then `git worktree remove` the worktree and `git branch -d` the branch.
4. **Auto-review before merging.** Before merging, dispatch a fresh reviewer subagent (general-purpose, `requesting-code-review` style prompt) against the full branch diff vs `main`. Fix its findings on the branch, re-review, repeat until clean.
5. **Interactive merge gate.** After review passes, ask the user (interactive prompt / `question` tool) whether to merge the branch into `main`. Never merge without explicit user confirmation.

## Architecture: provider registry → direct fetch → relay fallback

`providers.js` defines the `AIUsageProviders` registry and the shared helpers; each `providers/*.js` file registers one adapter (`id`, `label`, `plan` (optional — omit when no plan field exists), `needs` — `'key'` or `'session'` — `openUrl`, `refresh`, `settingsHtml`, `readSettings`). `popup.html` and `options.html` load `providers.js` first, then every `providers/*.js`. The popup renders and refreshes only the enabled providers (`loadProviderPrefs` → `AIUsageProviders.enabledIds`); fresh installs have all providers disabled until enabled in Settings.

On refresh, each adapter first fetches usage directly from the extension context (`direct*Usage()`). On failure it falls back to `relayMessage` (providers.js), which sends a message to an open provider tab:

- `{ type: 'AI_USAGE_CLAUDE' }` → relay-claude.js
- `{ type: 'AI_USAGE_CHATGPT' }` → relay-chatgpt.js
- `{ type: 'AI_USAGE_COPILOT' }` → relay-copilot.js
- `{ type: 'AI_USAGE_GEMINI' }` → relay-gemini.js
- `{ type: 'AI_USAGE_CURSOR' }` → relay-cursor.js
- `{ type: 'AI_USAGE_PERPLEXITY' }` → relay-perplexity.js
- `{ type: 'AI_USAGE_MISTRAL' }` → relay-mistral.js
- `{ type: 'AI_USAGE_GROK' }` → relay-grok.js

The relay scripts and their adapters must stay in sync: message type, request flow, and response shape `{ ok: true, data }` / `{ ok: false, error }`. Each relay guards re-install with `globalThis.__aiUsage*RelayInstalled` (SPAs re-inject content scripts). Copilot and Gemini are currently degraded: their adapters render a "not available" message (endpoint retired / no endpoint found); Grok covers free-tier gates only.

## Conventions to preserve

- Shared helpers live in `providers.js` and are loaded before the adapters: `jsonFetch`, `relayMessage`, `metricHtml`, `escapeHtml`, `errorHtml`, `loadProviderPrefs`, `toPercent`, `clampPercent`, `firstNumber`, reset/`money` formatters, and the `AIUsageProviders` registry. Any adapter may use them; extend them there.
- Parser helpers (`collectOrgIds`, `findAccessToken`, `findAccountId`, JWT decode) are intentionally duplicated in each provider's adapter file *and* its relay script — content scripts are isolated from extension context and there is no bundler. Do not "DRY" parsers into `providers.js` or shared modules; only the generic helpers above belong there.
- The usage endpoints are internal and unstable. All adapters parse defensively with alias chains (e.g. `w.usageDollars ?? w.usage_dollars ?? w.used ?? w.usage`); keep that pattern when extending parsers. `toPercent` (providers.js) normalizes Claude's inconsistent 0..1 vs 0..100 scales.
- Claude usage requires the `anthropic-client-platform: web_claude_ai` header. ChatGPT requires a Bearer token from `/api/auth/session` plus `ChatGPT-Account-Id` when present.
- The only stored secret is `opencodeApiKey` in `chrome.storage.local` (options.js). Never store session cookies or tokens for the session-based providers.
