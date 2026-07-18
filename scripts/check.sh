#!/usr/bin/env bash
set -euo pipefail
TSC="${TSC:-tsc}"
COMMON=(--noEmit --strict --target ES2020 --lib ES2020,DOM --module none --skipLibCheck)
"$TSC" "${COMMON[@]}" anime/animeflv/online-streaming-provider.d.ts anime/animeflv/provider.ts
"$TSC" "${COMMON[@]}" anime/jkanime/online-streaming-provider.d.ts anime/jkanime/provider.ts
"$TSC" "${COMMON[@]}" manga/manhwaweb/manga-provider.d.ts manga/manhwaweb/provider.ts
printf 'TypeScript OK\n'
