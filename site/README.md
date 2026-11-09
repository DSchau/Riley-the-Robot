# rileytherobot.com

Companion site for the book, built with Astro and served from Cloudflare Workers static assets.

```sh
pnpm install
pnpm dev       # local dev server
pnpm assets    # re-render book pages/art from ../interior*.pdf, ../cover*.pdf, ../images
pnpm deploy    # build and deploy to rileytherobot.com (wrangler)
```

`pnpm assets` needs `pdftopng` (xpdf) or `pdftoppm` (poppler) and ImageMagick. Page counts per
edition live in `src/data/editions.ts`; update them if the interior PDFs change length.

Deep links open the reader directly: `/#read/12` (English, spread 12) or `/#leer/5` (Spanish).
