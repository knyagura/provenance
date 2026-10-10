// Runs the whole suite: every jsdom regression/attack script, then the real-browser layout audit.
// Usage: npm test   (from this folder). Exits non-zero if anything fails.
const { spawnSync } = require('child_process');
const path = require('path');
const suites = ['smoketest.js', 'attacktest.js', 'e2e_journey.js', 'check_real_camera.js', 'check_qr_scan.js',
  'check_webauthn.js', 'check_m4.js', 'check_cam_layout.js', 'sql_rls_check.mjs', 'two_user_journey.mjs',
  'real_browser_layout.js'];
let failed = [];
for (const s of suites) {
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], { encoding: 'utf8' });
  const ok = r.status === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${s}`);
  if (!ok) { failed.push(s); console.log((r.stdout + r.stderr).split('\n').slice(-25).join('\n')); }
}
console.log(failed.length ? `\n${failed.length} suite(s) failed: ${failed.join(', ')}` : `\nAll ${suites.length} suites passed.`);
process.exit(failed.length ? 1 : 0);
