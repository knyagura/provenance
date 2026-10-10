// Runs the whole suite: every jsdom regression/attack script, then the real-browser layout audit.
// Usage: npm test   (from this folder). Exits non-zero if anything fails.
const { spawnSync } = require('child_process');
const path = require('path');
const suites = ['smoketest', 'attacktest', 'e2e_journey', 'check_real_camera', 'check_qr_scan',
  'check_webauthn', 'check_m4', 'check_cam_layout', 'real_browser_layout'];
let failed = [];
for (const s of suites) {
  const r = spawnSync(process.execPath, [path.join(__dirname, s + '.js')], { encoding: 'utf8' });
  const ok = r.status === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${s}`);
  if (!ok) { failed.push(s); console.log((r.stdout + r.stderr).split('\n').slice(-25).join('\n')); }
}
console.log(failed.length ? `\n${failed.length} suite(s) failed: ${failed.join(', ')}` : `\nAll ${suites.length} suites passed.`);
process.exit(failed.length ? 1 : 0);
