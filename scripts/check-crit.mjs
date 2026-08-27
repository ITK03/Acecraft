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
const startX = 195;
const startY = 671;

// chip_targeting(Lv3, crit 16%)+mod_strike_s+mod_homingflareを直接所持させ、
// 主砲/フレア/ストライク/カウンターの全経路を一度に長めに動かして例外がないかを見る。
await page.evaluate(() => window.__forceApply('chip', 'chip_targeting', 3));
await page.evaluate(() => window.__forceApply('module', 'mod_strike_s', 1));
await page.evaluate(() => window.__forceApply('module', 'mod_homingflare', 1));
const state = await page.evaluate(() => window.__debug());
console.log('state:', JSON.stringify(state));

await page.mouse.move(startX, startY);
await page.mouse.down();
for (let i = 0; i < 8; i += 1) {
  await page.waitForTimeout(1000);
  // 時々離してカウンターも撃つ(charge蓄積がある前提で短くDRAINしてから再タップ)
  if (i === 4) {
    await page.mouse.up();
    await page.waitForTimeout(1500);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.waitForTimeout(300);
  }
}
await page.mouse.up();

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');
await browser.close();
