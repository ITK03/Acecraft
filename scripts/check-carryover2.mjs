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

// チャージを溜める(natural DRAIN)
await page.waitForTimeout(15000);
await page.screenshot({ path: dir + 'co2-1-charged.png' });

// 現実的な短いタップ(120ms、mainGun.fireInterval=0.24sより短いので1発だけ出るはず)
await page.mouse.move(startX, startY);
await page.mouse.down();
await page.waitForTimeout(120);
await page.mouse.up();
await page.screenshot({ path: dir + 'co2-2-after-short-tap.png' });

// 少し待って(DRAIN中、charge微増の可能性あり)から再度タップ→残りが続けて出るか
await page.waitForTimeout(300);
await page.mouse.move(startX, startY);
await page.mouse.down();
await page.waitForTimeout(120);
await page.screenshot({ path: dir + 'co2-3-second-tap.png' });
await page.mouse.up();

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');
await browser.close();
