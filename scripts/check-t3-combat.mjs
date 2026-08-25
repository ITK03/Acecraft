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

// 何も触らない: MOVE に入っていないので主砲は撃たないはず(craft は DRAIN のまま)
await page.screenshot({ path: dir + 't3-1-idle-drain.png' });

// タップして MOVE に入れる(主砲が撃ち始める)。指を置いたままにする。
const startX = 195;
const startY = 671;
await page.mouse.move(startX, startY);
await page.mouse.down();
await page.waitForTimeout(3000); // 敵の湧き(0.6s間隔)と被弾を複数回観測する
await page.screenshot({ path: dir + 't3-2-firing.png' });

await page.waitForTimeout(4000);
await page.screenshot({ path: dir + 't3-3-firing-longer.png' });

await page.mouse.up();

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');

await browser.close();
