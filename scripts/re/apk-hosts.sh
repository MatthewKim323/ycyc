#!/usr/bin/env bash
# Discover step for a phone-only app: pull hosts, API paths and auth hints out of an APK or
# a split bundle (.apks/.xapk/.apkm). No decompiler needed.
#   scripts/re/apk-hosts.sh <file.apk|file.apks> <out-dir> [host-substring]
# Writes <out-dir>/strings.txt and prints hosts, path-like strings and auth hints.
set -euo pipefail
src="$1"; out="$2"; focus="${3:-}"
mkdir -p "$out/x"
case "$src" in
  *.apks|*.xapk|*.apkm|*.zip)
    unzip -q -o "$src" -d "$out/bundle"
    for a in "$out"/bundle/*.apk; do
      n=$(basename "$a" .apk)
      mkdir -p "$out/x/$n" && unzip -q -o "$a" 'classes*.dex' 'resources.arsc' 'assets/*.json' 'assets/*.properties' -d "$out/x/$n" 2>/dev/null || true
    done ;;
  *) unzip -q -o "$src" 'classes*.dex' 'resources.arsc' 'assets/*.json' 'assets/*.properties' -d "$out/x/base" 2>/dev/null || true ;;
esac
find "$out/x" -type f \( -name '*.dex' -o -name '*.arsc' -o -name '*.json' -o -name '*.properties' \) -print0 | xargs -0 strings -a > "$out/strings.txt"
echo "== hosts"
grep -oE 'https?://[A-Za-z0-9._-]+(:[0-9]+)?' "$out/strings.txt" | sort | uniq -c | sort -rn | grep -vE 'w3\.org|schemas\.android|apache\.org|googleapis\.com/auth|xmlpull|ns\.adobe' | head -40
echo "== api-ish paths"
grep -E '^[a-z0-9_{}./-]*(v[0-9]+|api|users?|cycles?|periods?|symptoms?|events?|sessions?|auth|token|logs?)[a-z0-9_{}./-]*$' "$out/strings.txt" | grep '/' | grep -vE '^/(system|data|proc|dev|sdcard)|\.(png|xml|kt|java|so)$' | sort -u | head -150
echo "== auth hints"
grep -oiE '(client_?id|audience|realm|grant_type|auth0[a-z_]*|x-[a-z-]{3,30}|bearer)[^ ]{0,60}' "$out/strings.txt" | sort | uniq -c | sort -rn | head -40
if [ -n "$focus" ]; then echo "== lines containing $focus"; grep -F "$focus" "$out/strings.txt" | sort -u | head -80; fi
