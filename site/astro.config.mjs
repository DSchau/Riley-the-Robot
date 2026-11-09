// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://rileytherobot.com',
  // Astro 7 defaults to JSX-style whitespace stripping, which drops the spaces
  // between inline elements (e.g. text followed by a link); keep HTML-aware behaviour
  compressHTML: true,
});
