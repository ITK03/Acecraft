import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:4173/Acecraft/';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1000);

const dir = new URL('.', import.meta.url).pathname;
const startX = 195;
const startY = 671;

await page.mouse.move(startX, startY);
await page.mouse.down();
// 間を置かず素早く動かして、そのまま離す(速度を持たせる)
await page.mouse.move(startX + 150, startY, { steps: 3 });
await page.mouse.up(); // 一時停止を挟まずすぐ離す
await page.screenshot({ path: dir + 'fling-1-justreleased.png' });
await page.waitForTimeout(80);
await page.screenshot({ path: dir + 'fling-2-mid.png' });
await page.waitForTimeout(400);
await page.screenshot({ path: dir + 'fling-3-settled.png' });

await browser.close();
console.log('done');
