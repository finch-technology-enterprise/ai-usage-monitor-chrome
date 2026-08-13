# AI Usage Quota Monitor (Chrome Extension)

A tiny Manifest V3 Chrome extension for viewing subscription quota/usage for:

- OpenCode Go — 5-hour, weekly, monthly
- Claude — current-session and weekly limits (plus model-specific/extra-usage rows when returned)
- ChatGPT / Codex — weekly usage limit

## Install

1. Unzip the folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Choose the `ai-usage-monitor-chrome` folder.
6. Pin **AI Usage Monitor (Personal)** to the Chrome toolbar.
7. Right-click the extension → **Options** and paste your OpenCode Go API key.
8. Make sure you are signed in to `claude.ai` and `chatgpt.com` in the same Chrome profile.

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

### OpenCode Go

Calls:

`GET https://opencode.ai/zen/go/v1/usage`

using the API key you enter in Settings.

### Claude

Uses your existing Claude web login and calls the same internal usage API used by the Claude web interface:

`GET https://claude.ai/api/organizations/{orgId}/usage`

The extension first tries directly from the extension context. If that fails, it can relay the request through an already-open Claude tab.

### ChatGPT / Codex

Uses the existing ChatGPT browser session to obtain the current bearer token from:

`GET https://chatgpt.com/api/auth/session`

then calls:

`GET https://chatgpt.com/backend-api/wham/usage`

The extension first tries directly and falls back to an already-open ChatGPT tab if needed.

## Privacy / security

- No analytics.
- No external server owned by this extension.
- The OpenCode API key is saved in `chrome.storage.local` for convenience and is sent only to `opencode.ai`.
- Claude and ChatGPT cookies are not copied into extension storage.
- Host access is limited to `opencode.ai`, `claude.ai`, and `chatgpt.com`.
- The Claude and ChatGPT quota endpoints are internal web endpoints and may change without notice. If a provider changes its response shape or endpoint, update the corresponding adapter in `popup.js` / relay script.

## Troubleshooting

### Claude says to open the provider website

Open `https://claude.ai`, make sure you are logged in, then press Refresh in the extension.

### ChatGPT/Codex says to open the provider website

Open `https://chatgpt.com`, make sure you are logged in, then press Refresh.

### OpenCode returns 401/403

Open Settings and replace the OpenCode API key with the active Go API key used by your OpenCode configuration.

### Chrome shows site-access warnings

That is expected because quota retrieval requires requests/cookies for exactly these three sites. This extension intentionally does not request `<all_urls>`.
