import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:4173/Acecraft/';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(500);

const dir = new URL('.', import.meta.url).pathname;
const startX = 195;
const startY = 671;

await page.mouse.move(startX, startY);
await page.mouse.down();

// 8秒間、左右にゆっくり掃引して弾の通り道を広げる
const sweepDurationMs = 8000;
const steps = 40;
for (let i = 0; i < steps; i += 1) {
  const t = i / steps;
  const x = startX + Math.sin(t * Math.PI * 4) * 120;
  await page.mouse.move(x, startY, { steps: 2 });
  await page.waitForTimeout(sweepDurationMs / steps);
}
await page.screenshot({ path: dir + 't3-kill-sweep.png' });
await page.mouse.up();

console.log('done');
await browser.close();
