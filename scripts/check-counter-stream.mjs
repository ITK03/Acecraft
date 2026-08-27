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

// DRAINでチャージを溜める
await page.waitForTimeout(6000);
await page.screenshot({ path: dir + 'stream-1-charged.png' });

// タップ長押し(mouse.down のまま保持) -> ストリームで少しずつ発射されるはず
await page.mouse.move(startX, startY);
await page.mouse.down();
await page.waitForTimeout(80);
await page.screenshot({ path: dir + 'stream-2-just-started.png' });
await page.waitForTimeout(300);
await page.screenshot({ path: dir + 'stream-3-mid-stream.png' }); // 弾が複数発、時間差で出ているはず
await page.waitForTimeout(500);
await page.screenshot({ path: dir + 'stream-4-later.png' });

// 早めに指を離すケース: 再度チャージしてから即離す
await page.mouse.up();
await page.waitForTimeout(4000);
await page.mouse.move(startX, startY);
await page.mouse.down();
await page.waitForTimeout(60); // ごく短時間だけ長押し
await page.mouse.up();
await page.waitForTimeout(100);
await page.screenshot({ path: dir + 'stream-5-early-release.png' });

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');
await browser.close();
