import { chromium } from 'playwright-core';
const url = 'http://localhost:4173/Acecraft/';
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
const startX = 195, startY = 500;
// あまり撃たずに敵を降らせ続け、brawlerが自機に接触するまで待つ(HPの減少で接触ダメージを確認)
await page.mouse.move(startX, startY);
await page.mouse.down();
for (let i = 0; i < 200; i += 1) {
  await page.mouse.move(startX + Math.sin(i / 15) * 30, startY, { steps: 1 });
  await page.waitForTimeout(90);
  if (i % 40 === 39) await page.screenshot({ path: dir + `brawler-check-${i}.png` });
}
await page.mouse.up();
console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');
await browser.close();
