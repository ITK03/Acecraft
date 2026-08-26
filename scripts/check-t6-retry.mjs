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

// 45秒放置してゲームオーバーへ(check-t6-respawn.mjsと同条件)
await page.mouse.move(startX, startY);
await page.mouse.down();
await page.waitForTimeout(45000);
await page.mouse.up();

let navigated = false;
page.on('load', () => { navigated = true; });

// GAME OVER表示中にタップ -> リロードされるはず
await page.mouse.move(startX, startY);
await page.mouse.down();
await page.waitForTimeout(1500);
await page.mouse.up();

await page.screenshot({ path: dir + 't6-4-after-retry-tap.png' });
console.log('navigated (reload detected):', navigated);
console.log('done');

await browser.close();
