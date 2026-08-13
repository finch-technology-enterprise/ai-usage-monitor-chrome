# AGENTS.md

Personal Chrome extension (Manifest V3) that shows quota usage for OpenCode Go, Claude, and ChatGPT/Codex. Plain vanilla JS — no build system, no package.json, no tests, no lint. Git repo on GitHub (`main` is the default branch). See README.md for install and endpoint documentation.

## Working with this repo

- There is no build/test/lint step. Chrome loads the folder directly (`chrome://extensions` → Load unpacked). After editing, click **Reload** on the extension; content scripts (`relay-*.js`) additionally require refreshing the provider tab.
- Releasing: `bash release.sh vX.Y.Z` bumps `manifest.json` version from the tag, then `.github/workflows/publish.yml` zips the extension and uploads/publishes to the Chrome Web Store via `chrome-webstore-upload-cli` (GitHub secrets `CWS_*`). Store listing fields live in the Web Store dashboard, not the repo.
- `manifest.json` is the only wiring: `background.js` (service worker; toolbar click opens/focuses one standalone `popup.html` window, no `default_popup`), `options.html`+`options.js` (settings), content scripts `relay-claude.js` (claude.ai) and `relay-chatgpt.js` (chatgpt.com). Keep icons at `icons/icon{16,32,48,128}.png`.
- Permissions are intentionally narrow: `storage`, `cookies`, and host access only to `opencode.ai`, `claude.ai`, `chatgpt.com`. Don't widen them.

## Git workflow

1. **Conventional Commits.** Every commit title is `<type>(<scope>): <summary>` — types: `feat`, `fix`, `docs`, `refactor`, `perf`, `style`, `test`, `build`, `ci`, `revert`. Imperative mood, lowercase, ≤72 chars, no trailing period. Body (blank line after title) explains *why*, wrapped at ~72 chars; bullet points for multiple changes. Rewriting is allowed: `rebase -i` to tidy a branch's commits, squash before merging. Force-push with `--force-with-lease` is allowed on **feature branches only — never on `main`**.
2. **Always branch from latest main into a worktree.** Before starting work: `git fetch origin`, then `git pull --rebase` on local `main` (in the root checkout — `main` can never be checked out in a worktree) so it's current, then create the branch and worktree from `main`. Work only inside `.worktrees/<branch>` — the root checkout is shared, and other agents may be running worktrees on this repo. Branch names: `feature/<slug>`, `hotfix/<slug>`, `chore/<slug>`, `docs/<slug>` (older branches like `provider-flexibility` predate this naming). During active development, don't run git commands that touch `main` or other worktrees' branches while another agent is active — the merge step below is the exception.
3. **Local PR flow.** When the work is done and verified, merge the branch into `main` with `git merge --no-ff <branch>` (keeps branch history with a merge commit as the PR record), push `main` to origin, then `git worktree remove` the worktree and `git branch -d` the branch.
4. **Auto-review before merging.** Before merging, dispatch a fresh reviewer subagent (general-purpose, `requesting-code-review` style prompt) against the full branch diff vs `main`. Fix its findings on the branch, re-review, repeat until clean.
5. **Interactive merge gate.** After review passes, ask the user (interactive prompt / `question` tool) whether to merge the branch into `main`. Never merge without explicit user confirmation.

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
