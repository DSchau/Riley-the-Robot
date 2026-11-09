import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

// Rendered once at build time (the site is fully static), like the books card
// on dustinschau.com. Source images come from scripts/build-assets.sh.
export const prerender = true;

const WIDTH = 1200;
const HEIGHT = 630;

const require = createRequire(import.meta.url);
const font = (pkg: string, file: string) => readFile(require.resolve(`@fontsource/${pkg}/files/${file}`));
// Resolved from the project root: this module is bundled before it runs.
const dataUri = async (path: string, type: string) =>
  `data:${type};base64,${(await readFile(resolve('src/assets/og', path))).toString('base64')}`;

type Style = Record<string, string | number>;
type Node = { type: string; props: { style?: Style; children?: unknown; [key: string]: unknown } };

// Tiny element factory so satori can be used without React.
function h(type: string, props: Record<string, unknown> & { style?: Style }, ...children: unknown[]): Node {
  const flat = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
  return { type, props: { ...props, children: flat.length === 1 ? flat[0] : flat } };
}

// Deterministic starfield
let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const stars = Array.from({ length: 70 }, () => ({
  x: rand() * WIDTH,
  y: rand() * HEIGHT * 0.8,
  s: rand() < 0.85 ? 1.5 + rand() * 1.5 : 3 + rand() * 2,
  o: 0.35 + rand() * 0.6,
}));

function Book(cover: string) {
  const height = 468;
  const coverWidth = Math.round(height * 0.705);
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', alignItems: 'center' } },
    h(
      'div',
      {
        style: {
          display: 'flex',
          height,
          boxShadow: '0 40px 60px rgba(0, 0, 0, 0.55), 0 0 90px rgba(127, 216, 255, 0.18)',
          transform: 'rotate(-3deg)',
        },
      },
      // spine
      h('div', {
        style: {
          display: 'flex',
          width: 24,
          background: 'linear-gradient(90deg, #070d22 0%, #1d2c58 50%, #0d1636 100%)',
          borderTopLeftRadius: 4,
          borderBottomLeftRadius: 4,
        },
      }),
      // cover with hinge groove and a soft sheen
      h(
        'div',
        { style: { display: 'flex', position: 'relative', width: coverWidth, height } },
        h('img', { src: cover, width: coverWidth, height, style: { width: coverWidth, height, objectFit: 'cover' } }),
        h('div', {
          style: {
            display: 'flex',
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(90deg, rgba(0,0,0,0.4) 0%, rgba(255,255,255,0.18) 1.6%, rgba(0,0,0,0.22) 4%, rgba(0,0,0,0) 7%, rgba(0,0,0,0) 55%, rgba(255,255,255,0.10) 70%, rgba(0,0,0,0) 85%)',
          },
        }),
      ),
      // page block
      h('div', {
        style: {
          display: 'flex',
          width: 14,
          marginTop: 5,
          marginBottom: 5,
          background: 'linear-gradient(90deg, #d9cfbd 0%, #f6efe2 40%, #e6dccb 100%)',
          borderTopRightRadius: 3,
          borderBottomRightRadius: 3,
        },
      }),
    ),
  );
}

export const GET: APIRoute = async () => {
  const [fredoka600, montserrat900, nunito400, cover, riley] = await Promise.all([
    font('fredoka', 'fredoka-latin-600-normal.woff'),
    font('montserrat', 'montserrat-latin-900-normal.woff'),
    font('nunito', 'nunito-latin-400-normal.woff'),
    dataUri('cover.jpg', 'image/jpeg'),
    dataUri('riley.png', 'image/png'),
  ]);

  const tree = h(
    'div',
    {
      style: {
        display: 'flex',
        position: 'relative',
        width: WIDTH,
        height: HEIGHT,
        backgroundColor: '#0a1430',
        backgroundImage:
          'radial-gradient(circle at 78% 18%, rgba(64, 92, 180, 0.55) 0%, rgba(10, 20, 48, 0) 55%), radial-gradient(circle at 20% 95%, rgba(255, 122, 61, 0.16) 0%, rgba(10, 20, 48, 0) 45%), linear-gradient(180deg, #0a1430 0%, #13234d 100%)',
        fontFamily: 'Nunito',
        color: '#eef2ff',
      },
    },
    ...stars.map((s) =>
      h('div', {
        style: {
          display: 'flex',
          position: 'absolute',
          left: s.x,
          top: s.y,
          width: s.s,
          height: s.s,
          borderRadius: s.s,
          backgroundColor: `rgba(255, 255, 255, ${s.o.toFixed(2)})`,
          boxShadow: `0 0 ${s.s * 3}px rgba(180, 220, 255, 0.8)`,
        },
      }),
    ),
    // Riley, peeking up from the bottom-right corner
    h('img', {
      src: riley,
      width: 256,
      height: 341,
      style: { position: 'absolute', right: 18, bottom: -104, width: 256, height: 341 },
    }),
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', width: '100%', height: '100%', paddingLeft: 92 } },
      Book(cover),
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', marginLeft: 72, marginTop: -60 } },
        h(
          'div',
          { style: { display: 'flex', fontFamily: 'Fredoka', fontWeight: 600, fontSize: 20, letterSpacing: 4, color: '#ffa36e' } },
          'A PICTURE BOOK BY DUSTIN SCHAU',
        ),
        // One line, lettered like the cover (Gotham Black there, Montserrat Black here)
        h(
          'div',
          {
            style: {
              display: 'flex',
              marginTop: 20,
              fontFamily: 'Montserrat',
              fontWeight: 900,
              fontSize: 58,
              letterSpacing: -0.5,
              textShadow: '0 3px 0 rgba(0, 0, 0, 0.3)',
            },
          },
          'RILEY THE\u00a0',
          h('span', { style: { color: '#ff7a3d', textShadow: '0 3px 0 rgba(0, 0, 0, 0.3), 0 0 32px rgba(255, 122, 61, 0.5)' } }, 'ROBOT'),
        ),
        h(
          'div',
          { style: { display: 'flex', width: 360, marginTop: 24, fontSize: 27, lineHeight: 1.4, color: '#b8c3e6' } },
          'A sleepy child, a lonely robot, and three reasons to be.',
        ),
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              marginTop: 30,
              fontFamily: 'Fredoka',
              fontWeight: 600,
              fontSize: 24,
              color: '#7fd8ff',
            },
          },
          'rileytherobot.com',
        ),
      ),
    ),
  );

  const svg = await satori(tree as Parameters<typeof satori>[0], {
    width: WIDTH,
    height: HEIGHT,
    fonts: [
      { name: 'Fredoka', data: fredoka600, weight: 600, style: 'normal' },
      { name: 'Montserrat', data: montserrat900, weight: 900, style: 'normal' },
      { name: 'Nunito', data: nunito400, weight: 400, style: 'normal' },
    ],
  });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng();

  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
