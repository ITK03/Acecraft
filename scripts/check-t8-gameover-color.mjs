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
// タップ/ドラッグを一切せず放置する(=常にDRAIN寄りの無防備状態)。
// 通常弾はドレインを素通りするため被弾し続け、いずれ残機3を失ってGAME OVERになるはず。
await page.waitForTimeout(45000);
const dir = new URL('.', import.meta.url).pathname;
await page.screenshot({ path: dir + 't8-8-gameover-color.png' });

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');
await browser.close();
