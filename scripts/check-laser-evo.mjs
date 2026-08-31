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

// craft を MOVE 状態にしてレーザーを実際に発動させる。
await page.mouse.move(195, 500);
await page.mouse.down();
await page.waitForTimeout(200);

// --- 1. レーザーの射程制限(バグ修正)の確認 ---
await page.evaluate(() => window.__forceApply('module', 'mod_laser', 3));
await page.waitForTimeout(1500); // 敵弾が画面上部に湧く時間を確保
const laserState = await page.evaluate(() => window.__debug());
console.log('laser state (Lv3, before evo):', JSON.stringify(laserState, null, 2));

// --- 2. 進化システムの確認: mod_laser Lv3 + chip_lens 所持 → 次の3択に mod_laser_evo が確定で出るはず ---
await page.evaluate(() => window.__forceApply('chip', 'chip_lens', 1));
const choices = await page.evaluate(() => window.__rollChoices(50));
console.log('rollChoices(50) after mod_laser Lv3 + chip_lens:', JSON.stringify(choices, null, 2));

const evoChoice = choices.find((c) => c.id === 'mod_laser_evo');
if (!evoChoice) {
  console.log('FAIL: mod_laser_evo not found in guaranteed choices');
} else {
  await page.evaluate((choice) => window.__applyChoiceObj(choice), evoChoice);
  const afterEvo = await page.evaluate(() => window.__debug());
  console.log('state after applying evolution:', JSON.stringify(afterEvo, null, 2));
  const ok =
    afterEvo.moduleLevels.mod_laser === undefined &&
    afterEvo.moduleLevels.mod_laser_evo === 1 &&
    afterEvo.laserHalfWidth === 62 &&
    afterEvo.laserDamagePerSecond === 72;
  console.log(ok ? 'EVOLUTION OK' : 'EVOLUTION FAILED');
}

await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/laser-evo.png' });

await page.mouse.up();

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log(messages.length === 0 ? 'NO ERRORS' : `${messages.length} ERROR(S)`);
console.log('done');
await browser.close();
