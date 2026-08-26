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

// 短縮ステージ(1ウェーブ1体)なのですぐクリアしてボスが出現するはず。掃引しながら倒す。
await page.mouse.move(startX, startY);
await page.mouse.down();

const phase1Ms = 6000;
for (let i = 0; i < 30; i += 1) {
  const t = i / 30;
  await page.mouse.move(startX + Math.sin(t * Math.PI * 6) * 130, startY, { steps: 1 });
  await page.waitForTimeout(phase1Ms / 30);
}
await page.screenshot({ path: dir + 't7-1-boss-entry-or-fight.png' });

// さらに掃引を続けてボスにダメージを与え、大技の予告(telegraphing)を捉える
for (let i = 0; i < 60; i += 1) {
  const t = i / 60;
  await page.mouse.move(startX + Math.sin(t * Math.PI * 8) * 140, startY, { steps: 1 });
  await page.waitForTimeout(120);
}
await page.screenshot({ path: dir + 't7-2-boss-fighting.png' });

await page.mouse.up();

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');

await browser.close();
