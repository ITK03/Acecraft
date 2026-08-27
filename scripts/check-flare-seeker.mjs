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

// RNGドラフトを介さず直接 mod_homingflare / chip_seeker を所持状態にする(死んで抽選が
// 尽きるリスクを避けるための直接検証。適用経路自体はUIタップと同じ applyChoice を通る)。
await page.evaluate(() => window.__forceApply('module', 'mod_homingflare'));
await page.evaluate(() => window.__forceApply('chip', 'chip_seeker'));
const afterApply = await page.evaluate(() => window.__debug());
console.log('after forceApply:', JSON.stringify(afterApply));

// MOVE状態を維持してフレアが実際に発射・追尾し、敵に当たって消えることを観察する。
await page.mouse.move(startX, startY);
await page.mouse.down();
for (let i = 0; i < 8; i += 1) {
  await page.waitForTimeout(700);
  const s = await page.evaluate(() => window.__debug());
  console.log(`t=${i}: flareBulletActive=${s.flareBulletActive} hp=${s.hp}`);
  await page.screenshot({ path: dir + `flare-seeker-${i}.png` });
}
await page.mouse.up();

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');
await browser.close();
