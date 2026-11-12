#!/usr/bin/env bash
# Renders the print PDFs and source art in the repo root into web-sized images
# under site/public. Re-run whenever interior*.pdf, cover*.pdf or images/ change.
#
# Requires: pdftopng (xpdf) or pdftoppm (poppler), ImageMagick (`magick`).
set -euo pipefail

SITE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$SITE/.." && pwd)"
OUT="$SITE/public/book"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

DPI=200
# Print PDFs carry a 9pt (0.125in) bleed on every side; trim it off.
BLEED_PX=$(( 9 * DPI / 72 ))
PAGE_HEIGHT=1400
QUALITY=82

render() { # render <pdf> <out-prefix>
  if command -v pdftopng >/dev/null; then
    pdftopng -r "$DPI" "$1" "$2"
  else
    pdftoppm -r "$DPI" -png "$1" "$2"
  fi
}

build_interior() { # build_interior <pdf> <lang>
  local pdf="$1" lang="$2" dir="$OUT/$2"
  rm -rf "$dir" && mkdir -p "$dir"
  render "$ROOT/$pdf" "$TMP/$lang"
  local i=0
  for f in $(ls "$TMP/$lang"-*.png | sort); do
    i=$((i + 1))
    magick "$f" -shave "${BLEED_PX}x${BLEED_PX}" -resize "x${PAGE_HEIGHT}" \
      -quality "$QUALITY" "$dir/$(printf '%02d' "$i").webp"
  done
  echo "$lang: $i pages"
}

build_interior interior.pdf en
build_interior interior_es.pdf es

# Covers. English uses the flattened art from images/; Spanish is cropped from
# the right-hand (front) side of its case-wrap PDF, inside the 54pt wrap margin.
magick "$ROOT/images/cover-front.png" -resize "x${PAGE_HEIGHT}" -quality "$QUALITY" "$OUT/en/cover.webp"
magick "$ROOT/images/back-cover.png" -resize "x${PAGE_HEIGHT}" -quality "$QUALITY" "$OUT/en/back.webp"
magick "$ROOT/images/spine.png" -resize "x${PAGE_HEIGHT}!" -quality "$QUALITY" "$OUT/en/spine.webp"

render "$ROOT/cover_es.pdf" "$TMP/cover_es"
wrap=$(( 54 * DPI / 72 ))
magick "$TMP/cover_es-000001.png" -shave "${wrap}x${wrap}" "$TMP/es-trim.png"
read -r w h < <(magick identify -format '%w %h\n' "$TMP/es-trim.png")
front_w=$(( h * 1749 / 2481 ))
magick "$TMP/es-trim.png" -gravity East -crop "${front_w}x${h}+0+0" +repage \
  -resize "x${PAGE_HEIGHT}" -quality "$QUALITY" "$OUT/es/cover.webp"
magick "$TMP/es-trim.png" -gravity West -crop "${front_w}x${h}+0+0" +repage \
  -resize "x${PAGE_HEIGHT}" -quality "$QUALITY" "$OUT/es/back.webp"
spine_w=$(( w - 2 * front_w ))
if [ "$spine_w" -gt 4 ]; then
  magick "$TMP/es-trim.png" -gravity Center -crop "${spine_w}x${h}+0+0" +repage \
    -resize "60x${PAGE_HEIGHT}!" -quality "$QUALITY" "$OUT/es/spine.webp"
else
  cp "$OUT/en/spine.webp" "$OUT/es/spine.webp"
fi

# Character art and extras used around the site.
ART="$SITE/public/art"
rm -rf "$ART" && mkdir -p "$ART"
img() { magick "$ROOT/images/$1" -resize "$2" -quality "$QUALITY" "$ART/$3.webp"; }
img riley.png x1000 riley
img riley-2.png x900 riley-wave
img riley-bye.png x1000 riley-sketch
img riley-pattern.png 900x riley-pattern
img riley-peeking-dust-jacket.png x1000 riley-peek
img wrap-up/01-be-kind.png 1400x be-kind
img wrap-up/02-work-hard.png 1400x work-hard
img wrap-up/03-have-fun.png 1400x have-fun
img bio.jpg 1200x author
magick "$ROOT/images/riley.png" -resize 512x512 -background none -gravity center -extent 512x512 "$SITE/public/riley-icon.png"

# Cover for the build-time OG card (src/pages/og.png.ts); satori can't read webp.
# The card's Riley (riley.png) is a photo of the WebGL model: scripts/og-riley.mjs.
OG="$SITE/src/assets/og"
mkdir -p "$OG"
magick "$ROOT/images/cover-front.png" -resize x900 -quality 86 "$OG/cover.jpg"

du -sh "$OUT" "$ART"
