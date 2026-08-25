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
await page.waitForTimeout(500);

const dir = new URL('.', import.meta.url).pathname;
const startX = 195;
const startY = 671;

// 何も触らず DRAIN のまま charge を溜める(T4検証で12秒でcharge=30に到達済み)
await page.waitForTimeout(14000);
await page.screenshot({ path: dir + 't5-1-charged.png' });

// タップしてカウンターを発動(charge>0なのでDRAIN->COUNTERに入るはず)
await page.mouse.move(startX, startY);
await page.mouse.down();
await page.waitForTimeout(16); // 1フレーム分だけ待って発動直後を捉える
await page.screenshot({ path: dir + 't5-2-counter-fired.png' });

await page.waitForTimeout(500); // counterDuration(0.35s)を超えて経過させる
await page.screenshot({ path: dir + 't5-3-after-counter.png' });

await page.mouse.up();

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');

await browser.close();
