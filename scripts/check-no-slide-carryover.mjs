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

// --- 1. スワイプしたまま指を離した直後、機体がその場で止まっているか(滑らないか) ---
const startX = 195;
const startY = 900; // 論理座標的にY=900あたり(移動可能範囲内)を狙って素早くスワイプ
await page.mouse.move(startX, startY);
await page.mouse.down();
// 速いスワイプを再現(短時間で大きく動かす)
for (let i = 0; i < 5; i += 1) {
  await page.mouse.move(startX + 100, startY - 5, { steps: 1 });
  await page.waitForTimeout(10);
}
await page.mouse.up();
await page.waitForTimeout(16);
await page.screenshot({ path: dir + 'noslide-1-just-released.png' });
await page.waitForTimeout(300);
await page.screenshot({ path: dir + 'noslide-2-300ms-later.png' }); // 機体の位置がjust-releasedと変わっていないはず

// --- 2. カウンター残弾の持ち越し ---
// チャージを溜める
await page.waitForTimeout(15000);
const chargeBefore = await page.evaluate(() => document.title); // ダミー(DOM経由でcharge読めないため後でスクショ目視)
void chargeBefore;
await page.screenshot({ path: dir + 'noslide-3-charged.png' });

// ごく短時間だけ長押しして1発だけ撃ち、すぐ離す
await page.mouse.move(startX, startY);
await page.mouse.down();
await page.waitForTimeout(16);
await page.mouse.up();
await page.screenshot({ path: dir + 'noslide-4-after-1shot.png' }); // charge が0にリセットされず残っているはず

// 再度タップして残りが続けて発射されるか
await page.waitForTimeout(500);
await page.mouse.move(startX, startY);
await page.mouse.down();
await page.waitForTimeout(16);
await page.screenshot({ path: dir + 'noslide-5-second-press.png' });
await page.mouse.up();

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');
await browser.close();
