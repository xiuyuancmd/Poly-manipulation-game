// End-to-end smoke test: serves the static site, loads it in headless
// Chromium, starts every level, performs a drag on level 1 and asserts the
// similarity readout responds. Run with: npm run e2e
import { spawn, execSync } from 'node:child_process';

// Local install first, then the globally installed playwright.
let pw;
try {
  pw = await import('playwright');
} catch {
  const globalRoot = execSync('npm root -g').toString().trim();
  pw = await import(`${globalRoot}/playwright/index.mjs`);
}
const { chromium } = pw;

const PORT = 8127;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOT_DIR ?? null;

const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: new URL('../..', import.meta.url).pathname,
  stdio: 'ignore',
});

const fail = (msg) => { console.error(`FAIL: ${msg}`); cleanup(1); };
const cleanup = (code) => { server.kill(); process.exit(code); };
await new Promise(r => setTimeout(r, 800));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 5000 });

const levelCount = await page.locator('.level-card').count();
console.log(`menu ok, ${levelCount} levels`);

// World -> element coordinate helper (canvas is 960x640 internally).
const worldClick = async (wx, wy) => {
  const box = await page.locator('#game').boundingBox();
  return { x: box.x + (wx / 960) * box.width, y: box.y + (wy / 640) * box.height };
};

// 1. Every level must load and run 1.5s without console errors.
for (let i = 0; i < levelCount; i++) {
  await page.evaluate((idx) => window.__game.startLevel(idx), i);
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => window.__game.state);
  if (state !== 'playing') fail(`level ${i + 1} state=${state}`);
  if (errors.length) fail(`level ${i + 1} console errors: ${errors.join(' | ')}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/level${i + 1}.png` });
  console.log(`level ${i + 1} runs`);
}

// 2. Drag interaction on level 1 must move the similarity readout.
await page.evaluate(() => window.__game.startLevel(0));
await page.waitForTimeout(1200);
const simBefore = await page.evaluate(() => window.__game.sim?.total ?? null);
if (simBefore === null) fail('no similarity readout after level start');

// Drag the left edge far down-left — a clear shape distortion — and track the
// biggest similarity deviation seen while dragging.
const from = await worldClick(262, 320);
const to = await worldClick(110, 560);
await page.mouse.move(from.x, from.y);
await page.mouse.down();
let maxDelta = 0;
for (let s = 1; s <= 14; s++) {
  await page.mouse.move(
    from.x + ((to.x - from.x) * s) / 14,
    from.y + ((to.y - from.y) * s) / 14,
  );
  await page.waitForTimeout(120);
  const now = await page.evaluate(() => window.__game.sim?.total ?? null);
  if (now !== null) maxDelta = Math.max(maxDelta, Math.abs(now - simBefore));
}
await page.mouse.up();
if (maxDelta < 1) {
  fail(`similarity did not respond to dragging (before=${simBefore.toFixed(1)} maxDelta=${maxDelta.toFixed(1)})`);
}
console.log(`drag ok: similarity ${simBefore.toFixed(1)}, max deviation ${maxDelta.toFixed(1)}`);

// 3. Cut tool: knife across the body must produce two islands on level 1.
await page.evaluate(() => window.__game.startLevel(0));
await page.waitForTimeout(800);
await page.evaluate(() => window.__game.setTool('cut'));
const cutFrom = await worldClick(360, 140);
const cutTo = await worldClick(360, 520);
await page.mouse.move(cutFrom.x, cutFrom.y);
await page.mouse.down();
await page.mouse.move(cutTo.x, cutTo.y, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(600);
const islands = await page.evaluate(() => window.__game.session.body?.aliveIslands().length ?? -1);
if (islands !== 2) fail(`expected 2 islands after full cut, got ${islands}`);
console.log('cut ok: 2 islands');
if (errors.length) fail(`console errors: ${errors.join(' | ')}`);

await browser.close();
console.log('SMOKE PASS');
cleanup(0);
