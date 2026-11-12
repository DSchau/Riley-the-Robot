#!/usr/bin/env node
// Photographs the live WebGL Riley for the social card (src/pages/og.png.ts).
// Re-run after changing the model in src/riley:
//
//   astro dev --background && node scripts/og-riley.mjs
//
// Drives a headless Chrome over the DevTools protocol, so there is nothing to
// install. Set CHROME to the browser binary if it isn't in the usual place.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:4321/';
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../src/assets/og/riley.png');
const chromePath = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// CSS width of the Riley being photographed; the canvas is drawn at twice this.
const WIDTH = 320;
const PORT = 9339;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'og-riley-'));
const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], {
  stdio: 'ignore',
});

try {
  let targets;
  for (let i = 0; i < 50 && !targets; i++) {
    targets = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json(), () => undefined);
    if (!targets) await sleep(200);
  }
  if (!targets) throw new Error(`Could not start Chrome at ${chromePath}`);

  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    pending.get(d.id)?.(d.result);
    pending.delete(d.id);
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      pending.set(++id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const run = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1400, deviceScaleFactor: 2, mobile: false });
  // Reduced motion holds Riley still: no breathing, no glancing about.
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.navigate', { url });
  for (let i = 0; i < 100; i++) {
    if ((await run(`location.href !== 'about:blank' && document.readyState === 'complete'`)) === true) break;
    await sleep(200);
  }

  const png = await run(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const el = document.querySelector('.closing [data-riley]') ?? document.querySelector('[data-riley]');
    if (!el) return '';
    el.style.width = '${WIDTH}px';
    el.scrollIntoView({ block: 'center' });
    for (let i = 0; i < 100 && !el.classList.contains('riley3d-ready'); i++) await sleep(100);
    if (!el.classList.contains('riley3d-ready')) return '';
    // Let the hello wave finish, then catch Riley beaming.
    await sleep(3200);
    el.dispatchEvent(new CustomEvent('riley:mood', { detail: 'happy' }));
    el.dispatchEvent(new CustomEvent('riley:emote', { detail: 'wave' }));
    // Mid-wave, with the hand swung clear of the head.
    await sleep(1440);
    return el.querySelector('canvas').toDataURL('image/png');
  })()`);
  if (!png) throw new Error(`No WebGL Riley found at ${url}. Is the dev server running?`);

  writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
  console.log(`Wrote ${out}`);
  ws.close();
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
