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

const rect = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const r = c.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
});
const scale = rect.width / 720;
const cardCentersLogical = [
  { x: 10 + 220 / 2, y: 400 + 280 / 2 },
  { x: 250 + 220 / 2, y: 400 + 280 / 2 },
  { x: 490 + 220 / 2, y: 400 + 280 / 2 },
];
function toScreen(p) {
  return { x: rect.left + p.x * scale, y: rect.top + p.y * scale };
}
async function tapCard(index) {
  const p = toScreen(cardCentersLogical[index]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
}

let orbitAcquired = false;
for (let cycle = 0; cycle < 60 && !orbitAcquired; cycle += 1) {
  const state = await page.evaluate(() => window.__debug());
  if (state.runEnded) {
    // ゲームオーバー画面は放置(誤ってリトライタップしない)。時間経過での復帰はないため打ち切る。
    console.log(`cycle ${cycle}: runEnded, stopping. state=`, JSON.stringify(state));
    break;
  }
  if (state.pending) {
    const idx = state.pending.findIndex((c) => c.id === 'mod_orbit');
    const pick = idx === -1 ? 0 : idx;
    console.log(`cycle ${cycle}: pending=${JSON.stringify(state.pending)} -> tapping index ${pick}`);
    await tapCard(pick);
    await page.waitForTimeout(200);
    continue; // このサイクルは選択だけ行い、次サイクルからまた操作を再開する
  }
  if (state.orbitCount > 0) {
    orbitAcquired = true;
    console.log(`cycle ${cycle}: orbitCount=${state.orbitCount} acquired. state=`, JSON.stringify(state));
    break;
  }

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 0; i < 20; i += 1) {
    const t = i / 20;
    await page.mouse.move(startX + Math.sin(t * Math.PI * 4) * 120, startY, { steps: 1 });
    await page.waitForTimeout(75);
  }
  await page.mouse.up();
}

const finalState = await page.evaluate(() => window.__debug());
console.log('final state:', JSON.stringify(finalState));
await page.screenshot({ path: dir + 'mod-orbit-1-after-play.png' });

if (finalState.orbitCount > 0) {
  // オービターが可視状態で敵弾をブロックする瞬間を捉えるため、もう少し観察時間を稼ぐ。
  for (let i = 0; i < 6; i += 1) {
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.waitForTimeout(1200);
    await page.mouse.up();
    await page.waitForTimeout(300);
    await page.screenshot({ path: dir + `mod-orbit-2-observe-${i}.png` });
  }
}

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');
await browser.close();
