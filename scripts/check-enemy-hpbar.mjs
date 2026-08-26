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

await page.mouse.move(startX, startY);
await page.mouse.down();
// 短い掃引を繰り返して「撃っては止め」を作り、敵を倒しきらず被弾状態のまま止めやすくする
for (let round = 0; round < 6; round += 1) {
  for (let i = 0; i < 10; i += 1) {
    const t = i / 10;
    await page.mouse.move(startX + Math.sin(t * Math.PI * 2) * 150, startY, { steps: 1 });
    await page.waitForTimeout(60);
  }
  await page.screenshot({ path: dir + `hpbar-check-${round}.png` });
}
await page.mouse.up();

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');
await browser.close();
