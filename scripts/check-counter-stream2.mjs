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

// 長めにDRAINでチャージを溜める(自然な待機。過去の検証でも同様の時間で高チャージに到達している)
await page.waitForTimeout(20000);
await page.screenshot({ path: dir + 'stream2-1-charged.png' });

await page.mouse.move(startX, startY);
await page.mouse.down();
for (let i = 0; i < 15; i += 1) {
  await page.waitForTimeout(100);
  await page.screenshot({ path: dir + `stream2-tick-${i}.png` });
}
await page.mouse.up();

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');
await browser.close();
