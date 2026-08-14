# AI Usage Quota Monitor (Chrome Extension)

A tiny Manifest V3 Chrome extension for viewing subscription quota/usage for:

- **OpenCode** — 5-hour, weekly, monthly usage percentages (plan badge: Go; needs an API key)
- **Claude** — current-session and weekly limits (plus model-specific/extra-usage rows when returned)
- **ChatGPT / Codex** — weekly usage limit
- **GitHub Copilot** — signed-in session; currently degraded (endpoint retired, card shows "not available")
- **Google Gemini** — signed-in session; currently not available (no public endpoint)
- **Cursor** — usage percentage against the monthly request pool
- **Perplexity** — remaining counts per feature (Pro Search, Deep Research, Labs, agentic research, free queries)
- **Mistral Le Chat** — remaining counts per capability (messages, fast reasoning, deep research, …)
- **xAI Grok** — remaining counts for the free-tier gates only (chat, image & video, voice, build)

Except OpenCode, every provider uses your existing signed-in session on its website — no extra login inside the extension.

## Install

1. Unzip the folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Choose the `ai-usage-monitor-chrome` folder.
6. Pin **AI Usage Monitor (Personal)** to the Chrome toolbar.
7. Right-click the extension → **Options**, enable the providers you subscribe to, and paste your OpenCode Go API key if using OpenCode.
8. For each enabled session-based provider, make sure you are signed in to its website in the same Chrome profile: `claude.ai`, `chatgpt.com`, `github.com` (Copilot), `gemini.google.com`, `cursor.com`, `www.perplexity.ai`, `chat.mistral.ai`, `grok.com`.

On a fresh install no providers are enabled and the popup shows an empty state — open Settings to enable the ones you use.

## Dock launcher (macOS)

Optional: give the usage window its own launcher icon in the Dock instead of opening it from the toolbar.

```sh
bash install-launcher.sh   # installs "AI Usage Monitor.app" into ~/Applications
bash uninstall-launcher.sh # removes it
```

After installing, drag **AI Usage Monitor** from `~/Applications` into the Dock and choose *Options → Keep in Dock*. Clicking the Dock icon opens or focuses the usage window without touching the browser. The launcher script detects the extension ID automatically from the browser profile.

## Releasing to the Chrome Web Store

1. Create the store item once in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) (upload any zip; you'll replace it on each release).
2. Create a Google Cloud OAuth client and obtain a refresh token — follow [fregante/chrome-webstore-upload-keys](https://github.com/fregante/chrome-webstore-upload-keys).
3. Add GitHub Actions secrets: `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_PUBLISHER_ID`.
4. Cut a release — this bumps `manifest.json`, tags, and pushes, and the `publish.yml` workflow zips and uploads/publishes to the store:

```sh
bash release.sh v1.0.1
```

The submission still goes through Chrome's review process; the workflow automates the upload + submit step.

## How it works

Every provider tries to fetch usage directly from the extension context first; if that fails, it relays the request through an already-open tab of that provider's website. Each provider card lists what it needs and what it shows. (Gemini is the exception today: it skips fetching — no endpoint exists — and Copilot lands in the same "not available" state since its endpoint is retired.)

### OpenCode

Needs an API key from the OpenCode Go plan, pasted in Settings (stored in `chrome.storage.local`; sent only to `opencode.ai`).

Calls:

`GET https://opencode.ai/zen/go/v1/usage`

with the key as a Bearer token, and shows 5-hour, weekly, and monthly usage percentages.

### Claude

Needs a signed-in session at `claude.ai`. Calls the same internal usage API used by the Claude web interface:

`GET https://claude.ai/api/organizations/{orgId}/usage`

(requires the `anthropic-client-platform: web_claude_ai` header). Direct fetch first, relay fallback through an open Claude tab.

### ChatGPT / Codex

Needs a signed-in session at `chatgpt.com`. Reads the bearer token from:

`GET https://chatgpt.com/api/auth/session`

then calls:

`GET https://chatgpt.com/backend-api/wham/usage`

(plus a `ChatGPT-Account-Id` header when present). Direct fetch first, relay fallback through an open ChatGPT tab.

### GitHub Copilot

Needs a signed-in session at `github.com` with Copilot enabled. The usage endpoint

`GET https://api.githubcopilot.com/meta`

has been retired — it returns HTTP 404 for everyone, not auth-gated — so the card currently shows "not available". The parser still understands the historical response shape defensively and lights up if the endpoint ever returns.

### Google Gemini

Needs a signed-in session at `gemini.google.com`. No stable usage/quota endpoint is documented or reachable today, so the card shows "not available". A relay is wired to a best-guess path so it can light up if Google ever exposes a real endpoint.

### Cursor

Needs a signed-in session at `cursor.com`. Calls:

`GET https://cursor.com/api/usage`

(session-gated). Direct fetch first, relay fallback through an open Cursor tab.

### Perplexity

Needs a signed-in session at `www.perplexity.ai`. Calls:

`GET https://www.perplexity.ai/rest/rate-limit/all`

plus `/rest/user/settings` for the plan tier. The endpoint exposes remaining counts, so the card renders "N left" rows (Pro Search, Deep Research, Labs, agentic research, free queries) instead of a percentage. Direct fetch first, relay fallback through an open Perplexity tab.

### Mistral Le Chat

Needs a signed-in session at `chat.mistral.ai`. Calls the app's tRPC procedure:

`GET https://chat.mistral.ai/api/trpc/user.limits`

and renders remaining counts per capability (messages, fast reasoning, deep research, …). Direct fetch first, relay fallback through an open Mistral tab.

### xAI Grok

Needs a signed-in session at `grok.com`. Calls:

`GET https://grok.com/rest/usage/free-usage-gates`

and renders remaining counts for the free-tier gates (chat, image & video, voice, build). SuperGrok-only usage pools are not covered, so subscribers on plans without gates may see nothing. Direct fetch first, relay fallback through an open Grok tab.

## Privacy / security

- No analytics.
- No external server owned by this extension.
- The OpenCode API key is saved in `chrome.storage.local` for convenience and is sent only to `opencode.ai`.
- Session cookies for the other providers are never copied into extension storage.
- Host access is limited to the provider sites this extension talks to: `opencode.ai`, `claude.ai`, `chatgpt.com`, `copilot.github.com`, `api.githubcopilot.com`, `gemini.google.com`, `cursor.com`, `www.perplexity.ai`, `chat.mistral.ai`, and `grok.com`. This extension intentionally does not request `<all_urls>`.
- The quota endpoints are internal web endpoints and may change without notice. If a provider changes its response shape or endpoint, update the corresponding adapter in `providers/*.js` or its relay script.

## Troubleshooting

### A provider says to open the provider website

Open the provider's site in a tab, make sure you are logged in, then press Refresh. If a tab was already open, reload it so the relay script re-injects:

- Claude — `https://claude.ai`
- ChatGPT / Codex — `https://chatgpt.com`
- GitHub Copilot — `https://copilot.github.com` (signed in to `github.com` with Copilot enabled)
- Google Gemini — `https://gemini.google.com`
- Cursor — `https://cursor.com`
- Perplexity — `https://www.perplexity.ai`
- Mistral Le Chat — `https://chat.mistral.ai`
- xAI Grok — `https://grok.com`

### A provider card shows "Usage not available yet"

That is the degraded state: the adapter could not reach a working usage endpoint. The card shows a compact message instead of a quota bar. Today this is expected for:

- **GitHub Copilot** — the usage endpoint is retired (see above).
- **Google Gemini** — no usage endpoint exists yet (see above).
- **xAI Grok** — only the free-tier gates are covered; SuperGrok accounts without gates may show nothing.

Other providers show this too when the endpoint is unreachable or the response shape changes — it is the honest fallback, not a bug.

### OpenCode returns 401/403

Open Settings and replace the OpenCode API key with the active Go plan API key used by your OpenCode configuration.

### Chrome shows site-access warnings

That is expected because quota retrieval requires requests/cookies for exactly these provider sites. This extension intentionally does not request `<all_urls>`.
