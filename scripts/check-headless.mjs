import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:4173/Acecraft/';
const durationMs = Number(process.argv[3] ?? 8000);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});

const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const consoleMessages = [];
page.on('console', (msg) => consoleMessages.push(`[console:${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => consoleMessages.push(`[pageerror] ${err.message}`));
page.on('requestfailed', (req) => consoleMessages.push(`[requestfailed] ${req.url()} ${req.failure()?.errorText}`));
page.on('response', (res) => {
  if (res.status() >= 400) consoleMessages.push(`[http ${res.status()}] ${res.url()}`);
});

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(durationMs);

const canvasInfo = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  return canvas ? { width: canvas.width, height: canvas.height, styleW: canvas.style.width, styleH: canvas.style.height } : null;
});

const screenshotPath = new URL('../scripts/headless-check.png', import.meta.url).pathname;
await page.screenshot({ path: screenshotPath });

console.log('--- canvas ---');
console.log(JSON.stringify(canvasInfo, null, 2));
console.log('--- console/page messages ---');
for (const m of consoleMessages) console.log(m);
console.log('--- screenshot ---');
console.log(screenshotPath);

await browser.close();
