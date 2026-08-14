#!/bin/bash
# Installs the AI Usage Monitor Dock launcher app into ~/Applications.
# Run from the extension folder:  bash install-launcher.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="AI Usage Monitor.app"
DEST="$HOME/Applications/$APP_NAME"
ICON_SRC="$ROOT/icons/icon128.png"

[ "$(uname)" = "Darwin" ] || { echo "This launcher is macOS-only." >&2; exit 1; }
[ -f "$ICON_SRC" ] || { echo "icons/icon128.png not found next to this script." >&2; exit 1; }

# Detect the extension ID from Brave/Chrome profile state (unpacked IDs derive
# from the folder path, so they differ per machine).
EXT_ID=""
for prefs in \
  "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/Default/Secure Preferences" \
  "$HOME/Library/Application Support/Google/Chrome/Default/Secure Preferences"; do
  [ -f "$prefs" ] || continue
  EXT_ID="$(python3 - "$prefs" "$ROOT" <<'PY'
import re, sys
raw = open(sys.argv[1], encoding="utf-8", errors="replace").read()
i = raw.find(sys.argv[2])
if i < 0:
    print("")
else:
    keys = list(re.finditer(r'"([a-p]{32})":\{', raw[:i]))
    print(keys[-1].group(1) if keys else "")
PY
)"
  [ -n "$EXT_ID" ] && break
done

if [ -z "$EXT_ID" ]; then
  echo "Could not detect the extension ID — is the extension loaded in Brave or Chrome?" >&2
  echo "Install it first (chrome://extensions → Load unpacked), then run this again." >&2
  exit 1
fi
echo "Extension ID: $EXT_ID"

# Build the app icon set.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ICONSET="$TMP/aiusage.iconset"
mkdir -p "$ICONSET"
for size in 16 32 64 128 256 512 1024; do
  sips -z "$size" "$size" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
done
sips -z 32 32 "$ICON_SRC" --out "$ICONSET/icon_16x16@2x.png" >/dev/null
sips -z 64 64 "$ICON_SRC" --out "$ICONSET/icon_32x32@2x.png" >/dev/null
sips -z 256 256 "$ICON_SRC" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
sips -z 512 512 "$ICON_SRC" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
sips -z 1024 1024 "$ICON_SRC" --out "$ICONSET/icon_512x512@2x.png" >/dev/null
iconutil -c icns "$ICONSET" -o "$TMP/aiusage.icns"

# Build the launcher AppleScript app.
cat > "$TMP/launch.applescript" << EOF
on run
 	set extUrl to "chrome-extension://${EXT_ID}/popup.html?container=window"
	if application "Brave Browser" is running then
		tell application "Brave Browser"
			repeat with w in windows
				try
					set u to URL of active tab of w
					if u starts with extUrl then
						set index of w to 1
						activate
						return
					end if
				end try
			end repeat
		end tell
	end if
	do shell script "open -na 'Brave Browser' --args --app='" & extUrl & "'"
	delay 0.5
	tell application "Brave Browser" to activate
end run
EOF

mkdir -p "$HOME/Applications"
osacompile -o "$DEST" "$TMP/launch.applescript"
cp "$TMP/aiusage.icns" "$DEST/Contents/Resources/applet.icns"
codesign --force --deep -s - "$DEST" >/dev/null 2>&1 || true

echo "Installed: $DEST"
echo
echo "Next steps:"
echo "  1. Open the Applications folder (Finder → Go → Applications, or run: open ~/Applications)"
echo "  2. Drag \"$APP_NAME\" into the Dock"
echo "  3. Right-click its Dock icon → Options → Keep in Dock"
echo
echo "Click the Dock icon to open/focus the usage window. Remove it with: bash uninstall-launcher.sh"
