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

// 機体を右寄りに固定してから敵を降らせ、左側に偏った的を作る(カウンター弾はまず正面=上方向へ
// 出るはずなので、追尾が効いていれば左の敵へ向けて曲がっていく様子が連続スクショで見えるはず)。
await page.mouse.move(startX + 120, startY, { steps: 1 });
await page.mouse.down();
for (let i = 0; i < 30; i += 1) {
  await page.mouse.move(startX + 120 + Math.sin(i / 5) * 10, startY, { steps: 1 });
  await page.waitForTimeout(70);
}
await page.mouse.up();
await page.waitForTimeout(3500); // DRAINでチャージを溜める

await page.mouse.move(startX + 120, startY, { steps: 1 });
await page.mouse.down();
await page.waitForTimeout(16);
await page.screenshot({ path: dir + 'homing-1-just-fired.png' });
await page.waitForTimeout(150);
await page.screenshot({ path: dir + 'homing-2-mid-flight.png' });
await page.waitForTimeout(150);
await page.screenshot({ path: dir + 'homing-3-later.png' });
await page.mouse.up();

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');
await browser.close();
