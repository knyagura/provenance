// Runs the page sweep and the journeys at the same time, on two ports, and fails if either fails.
// Usage: npm run build && npm run test:e2e:parallel
import { spawn } from 'node:child_process';

const run = (part, port) => new Promise((resolve) => {
  const p = spawn(process.execPath, ['tests/e2e/layout.mjs'], { stdio: 'inherit', env: { ...process.env, E2E_PART: part, E2E_PORT: String(port) } });
  p.on('exit', (code) => resolve(code ?? 1));
});
const codes = await Promise.all([run('layout', 3107), run('journeys', 3108)]);
process.exit(codes.some((c) => c !== 0) ? 1 : 0);
