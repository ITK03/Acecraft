import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:4173/Acecraft/';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

// rAFの間隔を計測して、フレームペーシングが時間経過(発熱相当)で悪化していないかを見る。
// DebugOverlayのテキストはキャンバス焼き込みで読み取れないため、rAF自体をフックする。
await page.addInitScript(() => {
  window.__frameDeltas = [];
  let last = performance.now();
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      window.__frameDeltas.push(t - last);
      last = t;
      cb(t);
    });
});

const messages = [];
page.on('pageerror', (err) => messages.push(`[pageerror] ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') messages.push(`[console:error] ${msg.text()}`);
});

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(500);

const dir = new URL('.', import.meta.url).pathname;

// --- T8: 背景・減光レイヤー・トグルの確認 ---
await page.screenshot({ path: dir + 't8-1-initial-background.png' });

await page.locator('button').click();
await page.waitForTimeout(300);
await page.screenshot({ path: dir + 't8-2-reduced-background.png' });

await page.locator('button').click();
await page.waitForTimeout(300);
await page.screenshot({ path: dir + 't8-3-back-to-normal.png' });

// --- 色確認: 戦闘中(自弾/敵弾/チャージ弾/クラフト)のスクリーンショット ---
const startX = 195;
const startY = 671;
await page.mouse.move(startX, startY);
await page.mouse.down();
for (let i = 0; i < 40; i += 1) {
  const t = i / 40;
  await page.mouse.move(startX + Math.sin(t * Math.PI * 6) * 130, startY, { steps: 1 });
  await page.waitForTimeout(100);
}
await page.screenshot({ path: dir + 't8-4-combat-colors.png' });
await page.mouse.up();
await page.waitForTimeout(3000); // ドレインでチャージ
await page.screenshot({ path: dir + 't8-5-drain-charge-ring.png' });
await page.mouse.move(startX, startY);
await page.mouse.down();
await page.waitForTimeout(50);
await page.screenshot({ path: dir + 't8-6-counter-white.png' });
await page.mouse.up();

// --- T9: 実プレイでの長時間ソーク(フレームペーシングの劣化がないかを見る近似検証) ---
console.log('soak start...');
const soakMs = 100000;
const soakStart = Date.now();
let i = 0;
while (Date.now() - soakStart < soakMs) {
  const t = i / 60;
  i += 1;
  const down = Math.floor(t) % 6 < 4; // ある程度DRAINも挟む周期パターン
  if (down) {
    await page.mouse.move(startX + Math.sin(t * Math.PI * 2) * 150, startY + Math.sin(t * 1.7) * 60, { steps: 1 });
    if (i % 60 === 1) await page.mouse.down();
  } else {
    if (i % 60 === 1) await page.mouse.up();
  }
  await page.waitForTimeout(50);
}
await page.mouse.up();
await page.screenshot({ path: dir + 't9-1-after-soak.png' });

const stats = await page.evaluate(() => {
  const d = window.__frameDeltas.filter((x) => x > 0 && x < 1000);
  const n = d.length;
  const avg = d.reduce((a, b) => a + b, 0) / n;
  const head = d.slice(0, Math.floor(n * 0.2));
  const tail = d.slice(Math.floor(n * 0.8));
  const headAvg = head.reduce((a, b) => a + b, 0) / head.length;
  const tailAvg = tail.reduce((a, b) => a + b, 0) / tail.length;
  const max = Math.max(...d);
  return {
    frames: n,
    avgFrameMs: avg,
    avgFps: 1000 / avg,
    headAvgFps: 1000 / headAvg,
    tailAvgFps: 1000 / tailAvg,
    maxFrameMs: max,
    heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
  };
});
console.log('--- soak stats ---');
console.log(JSON.stringify(stats, null, 2));

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');

await browser.close();
