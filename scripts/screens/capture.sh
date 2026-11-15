#!/usr/bin/env bash
# Walk every yuzu screen on the active Revyl cloud iPhone and save screenshots.
# Usage: scripts/screens/capture.sh <out_dir> [build_version_id]
# With a build id it installs that build first. Needs an active `revyl device` session.
set -u
OUT="${1:?out dir}"
BUILD="${2:-}"
R="${REVYL:-$HOME/.revyl/bin/revyl}"
mkdir -p "$OUT"

w() { "$R" device wait --duration-ms "${1:-1200}" >/dev/null 2>&1; }
shot() { "$R" device screenshot --out "$OUT/$1.png" >/dev/null 2>&1 && echo "shot $1"; }
tap() { "$R" device tap --target "$1" >/dev/null 2>&1 || echo "  (tap miss: $1)"; w "${2:-1300}"; }

if [ -n "$BUILD" ]; then
  "$R" device install --build-version-id "$BUILD" >/dev/null 2>&1 && echo "installed $BUILD"
fi
"$R" device kill-app >/dev/null 2>&1
"$R" device launch >/dev/null 2>&1; w 5000

# Onboarding
shot 01-welcome
tap "Get started button"; shot 02-set-it-up
tap "Pick your first app button" 1600; shot 03-pick
"$R" device type --target "Search any app field" --text "goodreads" >/dev/null 2>&1; w 2500; shot 04-search
tap "Strong" 1800; shot 05-connect
"$R" device back >/dev/null 2>&1; w 900
tap "Skip" 2000

# Tabs
shot 06-today
tap "Agent tab"; shot 07-agent
tap "Apps tab"; shot 08-apps
tap "Add tile" 1600; shot 09-add
tap "Back button" 1200
tap "Link tab"; shot 10-link
tap "For developers" 1000; shot 11-link-dev

# Paywall via deep link
"$R" device navigate --url "yuzu://paywall" >/dev/null 2>&1 || "$R" device navigate "yuzu://paywall" >/dev/null 2>&1; w 2000; shot 12-paywall
echo done
