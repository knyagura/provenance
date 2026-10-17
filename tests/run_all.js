// Runs the whole suite: every jsdom regression/attack script, then the real-browser layout audit.
// Usage: npm test   (from this folder). Exits non-zero if anything fails.
const { spawnSync } = require('child_process');
const path = require('path');
const suites = ['smoketest.js', 'attacktest.js', 'e2e_journey.js', 'check_real_camera.js', 'check_qr_scan.js',
  'check_webauthn.js', 'check_m4.js', 'check_cam_layout.js', 'sql_rls_check.mjs', 'custody_attacks.mjs', 'marketplace_checks.mjs', 'basket_checks.mjs', 'contact_checks.mjs', 'notification_checks.mjs', 'variant_checks.mjs', 'alert_checks.mjs', 'seller_checks.mjs', 'voucher_checks.mjs', 'popup_checks.mjs', 'two_user_journey.mjs',
  'real_browser_layout.js'];
let failed = [];
for (const s of suites) {
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], { encoding: 'utf8' });
  const ok = r.status === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${s}`);
  if (!ok) {
    failed.push(s);
    const tail = (r.stdout + r.stderr).split('\n').filter((l) => l.trim()).slice(-40).join('\n');
    console.log(tail);
    // In GitHub Actions, surface the failure as an annotation so it's readable without opening raw logs.
    if (process.env.GITHUB_ACTIONS) {
      const esc = (x) => x.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
      console.log(`::error title=${s} failed::${esc(tail.slice(-3500))}`);
    }
  }
}
console.log(failed.length ? `\n${failed.length} suite(s) failed: ${failed.join(', ')}` : `\nAll ${suites.length} suites passed.`);
process.exit(failed.length ? 1 : 0);
