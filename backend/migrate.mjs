// Applies new migration files in backend/ to the live Supabase database, in order, each in one transaction,
// and records each one in ops.applied_migrations so it never runs twice.
// Used by .github/workflows/migrate.yml after the database tests pass. Needs SUPABASE_ACCESS_TOKEN
// (a personal access token, stored only as a GitHub secret) and SUPABASE_PROJECT_REF.
// DRY_RUN=1 lists what would be applied without changing anything.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
const dry = process.env.DRY_RUN === '1';
const by = `github:${(process.env.GITHUB_SHA ?? 'local').slice(0, 7)}`;

if (!token || !ref) {
  console.log('::notice::SUPABASE_ACCESS_TOKEN is not set, so migrations were not applied. Add it under GitHub → Settings → Secrets → Actions.');
  process.exit(0);
}

async function query(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 2000)}`);
  return text ? JSON.parse(text) : [];
}

export const migrationFiles = (names) => names.filter((f) => /^\d{3}[a-z]?_[\w-]+\.sql$/.test(f)).sort();

const files = migrationFiles(readdirSync(dir));
const done = new Set((await query('select file from ops.applied_migrations')).map((r) => r.file));
const todo = files.filter((f) => !done.has(f));
if (!todo.length) {
  console.log('The database is up to date.');
  process.exit(0);
}
for (const f of todo) {
  const sql = readFileSync(path.join(dir, f), 'utf8');
  if (/^\s*(begin|commit|rollback)\s*;/im.test(sql)) throw new Error(`${f} manages its own transaction; apply it by hand.`);
  const sha = createHash('sha256').update(sql).digest('hex');
  if (dry) {
    console.log(`would apply ${f} (${sha.slice(0, 12)})`);
    continue;
  }
  console.log(`applying ${f} …`);
  await query(`begin;\n${sql}\n;\ninsert into ops.applied_migrations (file, sha256, applied_by) values ('${f}', '${sha}', '${by}');\ncommit;`);
  console.log(`applied ${f}`);
}
