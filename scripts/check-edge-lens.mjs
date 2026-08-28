import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:4173/Acecraft/';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const messages = [];
page.on('pageerror', (err) => messages.push(`[pageerror] ${err.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') messages.push(`[console:error] ${msg.text()}`); });

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(300);
const dir = new URL('.', import.meta.url).pathname;
const startX = 195;
const startY = 671;

await page.evaluate(() => window.__forceApply('chip', 'chip_edge', 3));
await page.evaluate(() => window.__forceApply('chip', 'chip_lens', 3));
await page.evaluate(() => window.__forceApply('module', 'mod_laser', 1));
const state = await page.evaluate(() => window.__debug());
console.log('state:', JSON.stringify(state));

await page.mouse.move(startX, startY);
await page.mouse.down();
await page.waitForTimeout(600);
await page.screenshot({ path: dir + 'edge-lens-1.png' });
await page.mouse.up();

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');
await browser.close();
