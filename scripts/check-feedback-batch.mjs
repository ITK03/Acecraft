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
await page.waitForTimeout(500);
const dir = new URL('.', import.meta.url).pathname;
const startX = 195;
const startY = 671;

// --- ドレイン範囲の可視化: 何もせず(起動直後はDRAIN)扇形が見えるはず ---
await page.waitForTimeout(1500);
await page.screenshot({ path: dir + 'fb-1-drain-cone.png' });

// --- 敵を降らせつつ、seeker(sineDown+aimed)とgrunt(straightDown+spread)が混在するのを見る ---
await page.mouse.move(startX, startY);
await page.mouse.down();
for (let i = 0; i < 60; i += 1) {
  const t = i / 60;
  await page.mouse.move(startX + Math.sin(t * Math.PI * 4) * 140, startY, { steps: 1 });
  await page.waitForTimeout(90);
}
await page.screenshot({ path: dir + 'fb-2-enemy-variety-and-hpbars.png' });

// --- チャージを溜めてカウンター弾を発射する瞬間 ---
await page.mouse.up();
await page.waitForTimeout(6000); // ドレインでチャージ+吸収エフェクト確認
await page.screenshot({ path: dir + 'fb-3-drain-absorbing.png' });
await page.mouse.move(startX, startY);
await page.mouse.down();
await page.waitForTimeout(16); // カウンター弾spawn直後の1フレーム
await page.screenshot({ path: dir + 'fb-4-counter-bullets-fired.png' });
await page.waitForTimeout(200);
await page.screenshot({ path: dir + 'fb-5-counter-bullets-flying.png' });
await page.mouse.up();

// --- 下スワイプでページ全体がスクロールしないことの確認 ---
const scrollBefore = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
await page.mouse.move(startX, 300);
await page.mouse.down();
for (let i = 0; i < 15; i += 1) {
  await page.mouse.move(startX, 300 + i * 20, { steps: 1 });
  await page.waitForTimeout(16);
}
await page.mouse.up();
const scrollAfter = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
console.log('scroll before/after:', JSON.stringify(scrollBefore), JSON.stringify(scrollAfter));

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');
await browser.close();
