import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:4173/Acecraft/';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const messages = [];
page.on('pageerror', (err) => messages.push(`[pageerror] ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') messages.push(`[console:error] ${msg.text()}`);
});

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(500);

const dir = new URL('.', import.meta.url).pathname;

// 初期表示確認(WAVE 1/10, HP 100/100, LIVES 3)
await page.screenshot({ path: dir + 't6-1-initial.png' });

// タップしたまま左右に掃引して敵を倒し、ウェーブ進行を狙う
const startX = 195;
const startY = 671;
await page.mouse.move(startX, startY);
await page.mouse.down();

const sweepDurationMs = 35000;
const steps = 140;
for (let i = 0; i < steps; i += 1) {
  const t = i / steps;
  const x = startX + Math.sin(t * Math.PI * 10) * 130;
  await page.mouse.move(x, startY, { steps: 1 });
  await page.waitForTimeout(sweepDurationMs / steps);
}
await page.screenshot({ path: dir + 't6-2-after-sweep.png' });
await page.mouse.up();

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');

await browser.close();
