// Dev helper: screenshot a page in headless Chromium (WebGL via SwiftShader) and print console errors.
//
//   node tools/shot.mjs <url> <out.png> [--size 390x844] [--wait "window.__ready"] [--delay 800]
//                       [--eval "js run before the shot"] [--touch]
//
// Start a server first (node tools/serve.mjs 8080). Exit code 1 if the page threw an uncaught error.

const args = process.argv.slice(2);
const url = args[0];
const out = args[1];
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
if (!url || !out) {
  console.error('usage: node tools/shot.mjs <url> <out.png> [--size WxH] [--wait expr] [--delay ms] [--eval js] [--touch]');
  process.exit(2);
}

let pw;
try {
  pw = await import('playwright');
} catch {
  pw = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
}
const [w, h] = opt('size', '390x844').split('x').map(Number);
const touch = args.includes('--touch');
const launch = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
else {
  try {
    const { existsSync } = await import('node:fs');
    const p = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
    if (existsSync(p)) launch.executablePath = p;
  } catch {}
}
const browser = await pw.chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
let failed = false;
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => {
  failed = true;
  console.log(`[pageerror] ${e.message}\n${e.stack || ''}`);
});
await page.goto(url, { waitUntil: 'load' });
const wait = opt('wait', null);
if (wait) await page.waitForFunction(wait, null, { timeout: 30000 });
const ev = opt('eval', null);
if (ev) {
  const r = await page.evaluate(ev);
  if (r !== undefined) console.log('eval ->', typeof r === 'string' ? r : JSON.stringify(r));
}
await page.waitForTimeout(+opt('delay', 600));
await page.screenshot({ path: out });
console.log(`saved ${out} (${w}x${h})`);
await browser.close();
process.exit(failed ? 1 : 0);
