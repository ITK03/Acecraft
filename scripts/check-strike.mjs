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

// RNGドラフトを介さず直接 mod_strike_s を所持状態にする(適用経路自体はUIタップと同じapplyChoice)。
await page.evaluate(() => window.__forceApply('module', 'mod_strike_s'));
const afterApply = await page.evaluate(() => window.__debug());
console.log('after forceApply:', JSON.stringify(afterApply));

// 敵を自然発生させつつ観察する。ストライクは2.5秒間隔なので、敵数の変化とリング演出を見る。
await page.mouse.move(startX, startY);
await page.mouse.down();
for (let i = 0; i < 6; i += 1) {
  await page.waitForTimeout(1500);
  const s = await page.evaluate(() => window.__debug());
  console.log(`t=${i * 1.5}s: enemies=${s.enemies} runEnded=${s.runEnded}`);
  await page.screenshot({ path: dir + `strike-${i}.png` });
}
await page.mouse.up();

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');
await browser.close();
