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

await page.mouse.move(startX, startY);
await page.mouse.down();

// 長めに掃引してボスにダメージを与え続け、フェーズ遷移(HPバー減少による硬直)を狙う
for (let i = 0; i < 400; i += 1) {
  const t = i / 400;
  await page.mouse.move(startX + Math.sin(t * Math.PI * 40) * 140, startY, { steps: 1 });
  await page.waitForTimeout(90);
}
await page.screenshot({ path: dir + 't7-3-boss-damaged.png' });

// 一旦離してドレインでチャージを溜め、ボスの近くでカウンターを撃つ
await page.mouse.up();
await page.waitForTimeout(4000); // DRAINでチャージを溜める
await page.screenshot({ path: dir + 't7-4-charged-near-boss.png' });

await page.mouse.move(startX, startY);
await page.mouse.down();
await page.waitForTimeout(50);
await page.screenshot({ path: dir + 't7-5-counter-vs-boss.png' });
await page.mouse.up();

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');

await browser.close();
