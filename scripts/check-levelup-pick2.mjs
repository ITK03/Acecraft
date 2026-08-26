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
for (let i = 0; i < 380; i += 1) {
  const t = i / 380;
  await page.mouse.move(startX + Math.sin(t * Math.PI * 10) * 150, startY, { steps: 1 });
  await page.waitForTimeout(80);
}
await page.mouse.up();
await page.screenshot({ path: dir + 'pick2-1-modal.png' });

// canvasの実際の画面上の位置とスケールを取得してから、論理座標(720x1280)のカード中心を
// 画面座標に正しく変換する(レターボックスのオフセットを考慮する)。
const rect = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const r = c.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
});
const scale = rect.width / 720;
const cardCenterLogicalX = 360;
const cardCenterLogicalY = 420 + 110;
const clickX = rect.left + cardCenterLogicalX * scale;
const clickY = rect.top + cardCenterLogicalY * scale;
console.log('canvas rect:', JSON.stringify(rect), 'click at', clickX, clickY);

await page.mouse.move(clickX, clickY);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(200);
await page.screenshot({ path: dir + 'pick2-2-after-pick.png' });

await page.mouse.move(startX, startY);
await page.mouse.down();
await page.waitForTimeout(600);
await page.screenshot({ path: dir + 'pick2-3-resumed.png' });
await page.mouse.up();

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');
await browser.close();
