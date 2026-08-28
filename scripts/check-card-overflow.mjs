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

// 現行の(修正前)ユーザー確認済み最長候補で、カード枠からのはみ出しを再現する。
await page.evaluate(() => {
  window.__showCards([
    { kind: 'module', id: 'mod_laser', name: 'ピアッシングレーザー', level: 1, description: '貫通レーザー(秒間20ダメージ)。触れた敵弾も防ぐ' },
    { kind: 'module', id: 'mod_strike_s', name: 'ピンポイントストライク', level: 1, description: '2.5秒ごとに最もHPの高い敵を爆撃(威力40)' },
    { kind: 'module', id: 'mod_blade', name: 'ウイングブレード', level: 1, description: '1.8秒ごとに至近の敵を薙ぐ(威力18)' },
  ]);
});
await page.screenshot({ path: dir + 'overflow-after.png' });

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');
await browser.close();
