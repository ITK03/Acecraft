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

// grunt(hp70)を主砲(damage16,fireInterval0.24)で倒すには時間がかかるが、複数体倒せばXPが貯まって
// レベルアップするはず(1→2は16XP、grunt撃破=4XP、seeker=5、brawler=6 なので数体で到達する)。
await page.mouse.move(startX, startY);
await page.mouse.down();
let leveledUp = false;
for (let i = 0; i < 400 && !leveledUp; i += 1) {
  const t = i / 400;
  await page.mouse.move(startX + Math.sin(t * Math.PI * 10) * 150, startY, { steps: 1 });
  await page.waitForTimeout(80);
  if (i % 20 === 19) {
    const visible = await page.evaluate(() => {
      // レベルアップモーダルの検知手段がDOM上にないため、画面のスクリーンショット差分は使わず
      // シンプルに一定時間ごとにスクショを撮って目視確認する方式にする(このブロックはno-op)。
      return null;
    });
    void visible;
  }
}
await page.screenshot({ path: dir + 'levelup-1-maybe-modal.png' });

console.log('--- messages ---');
for (const m of messages) console.log(m);
console.log('done');
await browser.close();
