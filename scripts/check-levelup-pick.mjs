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

await page.mouse.move(startX, startY);
await page.mouse.down();
for (let i = 0; i < 380; i += 1) {
  const t = i / 380;
  await page.mouse.move(startX + Math.sin(t * Math.PI * 10) * 150, startY, { steps: 1 });
  await page.waitForTimeout(80);
}
await page.screenshot({ path: dir + 'pick-1-modal.png' });

// 中央のカード(2枚目)をタップして選ぶ。カードはビューポート390x844に対して論理720x1280が
// scale=390/720で縮小表示されている想定。中央カードのおおよその画面座標を計算する。
const scale = 390 / 720;
const cardCenterLogicalX = 360; // 720幅の中央
const cardCenterLogicalY = 420 + 110; // CARD_Y(420) + CARD_HEIGHT/2(110)
await page.mouse.move(cardCenterLogicalX * scale, cardCenterLogicalY * scale);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(200);
await page.screenshot({ path: dir + 'pick-2-after-pick.png' });

// ゲームが再開しているか(craft状態が更新され続けるか)を少し動かして確認
await page.mouse.move(startX, startY);
await page.mouse.down();
await page.waitForTimeout(500);
await page.screenshot({ path: dir + 'pick-3-resumed.png' });
await page.mouse.up();

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');
await browser.close();
