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

const wanted = ['mod_homingflare', 'chip_gravity', 'chip_seeker'];
const acquired = new Set();

async function handlePendingIfAny() {
  const state = await page.evaluate(() => window.__debug());
  if (!state.pending) return state;
  let pick = -1;
  for (const id of wanted) {
    if (acquired.has(id)) continue;
    const idx = state.pending.findIndex((c) => c.id === id);
    if (idx !== -1) { pick = idx; break; }
  }
  if (pick === -1) pick = 0;
  console.log(`pending=${JSON.stringify(state.pending)} -> tapping index ${pick}`);
  await tapCard(pick);
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => window.__debug());
  if (after.flareInterval > 0) acquired.add('mod_homingflare');
  if (after.drainRadiusMultiplier > 1) acquired.add('chip_gravity');
  if (after.homingTurnRateMultiplier > 1) acquired.add('chip_seeker');
  return after;
}

// 「DRAINで溜めてCOUNTERで無敵になりつつ返す→MOVEで攻撃」という意図された循環に近い形で
// プレイし続けることで、MOVEしっぱなしの被弾特化テストより長く生存させ、レベルアップの
// 試行回数(=抽選回数)を稼ぐ。
let rounds = 0;
outer: for (; rounds < 40; rounds += 1) {
  // DRAIN(指を離してチャージを溜める)
  await page.mouse.up().catch(() => {});
  await page.waitForTimeout(2500);
  let state = await handlePendingIfAny();
  if (state.runEnded) break;
  if (acquired.size >= wanted.length) break;

  // タップしてCOUNTER(溜まっていれば無敵+反射)に入り、そのまま押し続けてMOVEへ継続
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 0; i < 24; i += 1) {
    const t = i / 24;
    await page.mouse.move(startX + Math.sin(t * Math.PI * 3) * 120, startY, { steps: 1 });
    await page.waitForTimeout(75);
    if (i % 8 === 7) {
      state = await handlePendingIfAny();
      if (state.runEnded) { await page.mouse.up().catch(() => {}); break outer; }
      if (acquired.size >= wanted.length) { await page.mouse.up().catch(() => {}); break outer; }
    }
  }
  await page.mouse.up();
}

const finalState = await page.evaluate(() => window.__debug());
console.log('final state:', JSON.stringify(finalState));
console.log('acquired:', JSON.stringify([...acquired]));
await page.screenshot({ path: dir + 'batch2-1-after-play.png' });

if (finalState.flareInterval > 0 && !finalState.runEnded) {
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 0; i < 5; i += 1) {
    await page.waitForTimeout(600);
    await page.screenshot({ path: dir + `batch2-2-flare-${i}.png` });
  }
  await page.mouse.up();
}

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');
await browser.close();
