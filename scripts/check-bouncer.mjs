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

// RNGドラフトを介さず直接mod_bouncerを所持状態にする(適用経路自体はUIタップと同じapplyChoice)。
await page.evaluate(() => window.__forceApply('module', 'mod_bouncer', 3));
const state = await page.evaluate(() => window.__debug());
console.log('state:', JSON.stringify(state));

// 機体を左右に振って敵を複数湧かせつつ、跳ね返り弾(紫)が複数の敵を渡り歩く様子を観察する。
await page.mouse.move(startX, startY);
await page.mouse.down();
for (let i = 0; i < 12; i += 1) {
  const t = i / 12;
  await page.mouse.move(startX + Math.sin(t * Math.PI * 3) * 130, startY, { steps: 1 });
  await page.waitForTimeout(200);
  const s = await page.evaluate(() => window.__debug());
  console.log(`t=${(i * 0.2).toFixed(1)}s: bulletsActive=${s.bulletsActive} enemies=${s.enemies}`);
  await page.screenshot({ path: dir + `bouncer-${i}.png` });
}
await page.mouse.up();

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');
await browser.close();
