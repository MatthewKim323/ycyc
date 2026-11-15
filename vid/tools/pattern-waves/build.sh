#!/bin/sh
# Bundles the seekable PatternWaves shader into vid/assets/pattern-waves.js (global window.PatternWaves).
cd "$(dirname "$0")" && npx --yes esbuild@0.25.10 entry.ts --bundle --format=iife --target=chrome120 --minify --outfile=../../assets/pattern-waves.js
