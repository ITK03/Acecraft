import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:4173/Acecraft/';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });

const messages = [];
page.on('pageerror', (err) => messages.push(`[pageerror] ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') messages.push(`[console:error] ${msg.text()}`);
});

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1000);

const dir = new URL('.', import.meta.url).pathname;

// craft の初期スポーン位置(論理 360, 1100)をビューポート(390x844)へ換算した近似スクリーン座標
const startX = 195;
const startY = 671;

await page.screenshot({ path: dir + 'craft-1-initial.png' });

// ドラッグ開始: 指を機体の近くに置く
await page.mouse.move(startX, startY);
await page.mouse.down();
await page.waitForTimeout(100);
await page.screenshot({ path: dir + 'craft-2-touchdown.png' });

// 上方向へゆっくりドラッグ(複数ステップで移動量を積む)
for (let i = 1; i <= 10; i += 1) {
  await page.mouse.move(startX + 40, startY - i * 25, { steps: 2 });
  await page.waitForTimeout(30);
}
await page.screenshot({ path: dir + 'craft-3-dragging.png' });

// 指を離す
await page.mouse.up();
await page.waitForTimeout(50);
await page.screenshot({ path: dir + 'craft-4-justreleased.png' });

await page.waitForTimeout(600);
await page.screenshot({ path: dir + 'craft-5-settled.png' });

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done. screenshots written to scripts/craft-*.png');

await browser.close();
