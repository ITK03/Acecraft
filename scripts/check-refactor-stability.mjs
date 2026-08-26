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

// MOVE(撃つ)とDRAIN->COUNTER(吸って撃つ)を繰り返し、EnemySystem/BulletSystem/DrainFieldの
// 新コード(敵2種、カウンター弾、HPバー、ドレイン範囲描画)を継続的に踏ませてクラッシュがないか見る。
for (let cycle = 0; cycle < 8; cycle += 1) {
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 0; i < 20; i += 1) {
    const t = i / 20;
    await page.mouse.move(startX + Math.sin(t * Math.PI * 3) * 150, startY, { steps: 1 });
    await page.waitForTimeout(50);
  }
  await page.mouse.up();
  await page.waitForTimeout(2500); // DRAIN
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.waitForTimeout(30); // COUNTER発動
  await page.mouse.up();
}
await page.screenshot({ path: dir + 'stability-final.png' });

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log(messages.length === 0 ? 'NO ERRORS' : 'ERRORS FOUND');
await browser.close();
