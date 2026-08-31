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

// craft の初期状態は DRAIN(指が触れていない)。MOVE/COUNTER中のみ動く各モジュールを
// 検証するには、実際に指(マウス)でタッチし続けて MOVE 状態へ遷移させる必要がある。
await page.mouse.move(195, 500);
await page.mouse.down();
await page.waitForTimeout(200);

await page.evaluate(() => window.__forceApply('module', 'mod_strike_a', 3));
await page.evaluate(() => window.__forceApply('module', 'mod_tesla', 3));
await page.evaluate(() => window.__forceApply('module', 'mod_mine', 3));
await page.evaluate(() => window.__forceApply('module', 'mod_drone', 3));
await page.evaluate(() => window.__forceApply('chip', 'chip_payload', 3));
await page.evaluate(() => window.__forceApply('chip', 'chip_hourglass', 3));
await page.evaluate(() => window.__forceApply('chip', 'chip_targeting', 3));

const afterApply = await page.evaluate(() => window.__debug());
console.log('after apply:', JSON.stringify(afterApply, null, 2));
await page.screenshot({ path: '/tmp/batch4-applied.png' });

// let the fixed-step loop run a few seconds so turret/mine/drone/area-strike all get a chance to fire
await page.waitForTimeout(5000);
const afterWait = await page.evaluate(() => window.__debug());
console.log('after 5s (touching, MOVE state):', JSON.stringify(afterWait, null, 2));
await page.screenshot({ path: '/tmp/batch4-running.png' });

await page.mouse.up();

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log(messages.length === 0 ? 'NO ERRORS' : `${messages.length} ERROR(S)`);
console.log('done');
await browser.close();
