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

// 何も触らない = craft は起動時から DRAIN のまま。敵が湧いて撃ってくるのを待つ。
// fireScript cooldown=1.8s、spawner interval=0.6s なので、十分な数の弾がドレイン圏内に入るはず。
await page.waitForTimeout(6000);
await page.screenshot({ path: dir + 't4-1-drain-6s.png' });

await page.waitForTimeout(6000);
await page.screenshot({ path: dir + 't4-2-drain-12s.png' });

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');

await browser.close();
