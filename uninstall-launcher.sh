#!/bin/bash
# Removes the AI Usage Monitor Dock launcher app.
set -euo pipefail

APP_NAME="AI Usage Monitor.app"
DEST="$HOME/Applications/$APP_NAME"

[ -d "$DEST" ] || { echo "Launcher not installed ($DEST)."; exit 0; }

read -r -p "Remove $APP_NAME from ~/Applications? [y/N] " answer
case "$answer" in
  [yY]*)
    osascript -e 'quit app "AI Usage Monitor"' >/dev/null 2>&1 || true
    rm -rf "$DEST"
    echo "Removed."
    ;;
  *)
    echo "Aborted."
    ;;
esac
