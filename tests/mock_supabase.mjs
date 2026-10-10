// A small local stand-in for a Supabase project, for tests and offline development.
//
// It speaks the subset of Supabase's HTTP APIs the app uses — Auth (GoTrue) sign-up / password /
// magic-link / refresh / user / logout, and the REST API (PostgREST) select / insert / update /
// delete with eq / in filters, order and limit — on top of a REAL Postgres engine (PGlite) running
// backend/supabase_schema.sql + migrations. Every REST request runs as the `anon` or
// `authenticated` role with the caller's user id, so Row Level Security, grants and triggers are
// enforced by Postgres exactly as they would be in Supabase. Realtime is not emulated.
//
//   node mock_supabase.mjs [port]      → http://localhost:54321 (default)
// Point the app at it with:  window.PROVENANCE_CONFIG_OVERRIDE = {supabaseUrl:'http://localhost:54321', supabaseKey:'mock'}
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { freshDb } from './sql_rls_check.mjs';

const TABLES = new Set(['profiles', 'listings', 'orders']);
const IDENT = /^[a-z_][a-z0-9_]*$/;

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function makeJwt(user) {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now })}.${crypto.randomBytes(16).toString('base64url')}`;
}
function userJson(u) {
  return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.created_at,
    phone: '', confirmed_at: u.created_at, last_sign_in_at: new Date().toISOString(), app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {}, identities: [], created_at: u.created_at, updated_at: u.created_at, is_anonymous: false };
}

export async function startMock(port = 54321) {
  const db = await freshDb();
  const users = new Map();          // email -> {id,email,password,created_at}
  const tokens = new Map();         // access token -> user
  const refresh = new Map();        // refresh token -> user
  const log = [];
  let queue = Promise.resolve();
  const serial = (fn) => (queue = queue.then(fn, fn));

  function session(u) {
    const access_token = makeJwt(u), refresh_token = crypto.randomBytes(12).toString('hex');
    tokens.set(access_token, u); refresh.set(refresh_token, u);
    return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token, user: userJson(u) };
  }
  function callerFrom(req) {
    const h = req.headers.authorization || '';
    const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
    return tokens.get(tok) || null;
  }

  // Run SQL as the caller, inside a transaction, the way PostgREST does.
  async function asCaller(user, sql, params) {
    return serial(() => db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user ? user.id : '']);
      await tx.exec(`set local role ${user ? 'authenticated' : 'anon'}`);
      return tx.query(sql, params);
    }));
  }

  function parseFilters(searchParams) {
    const where = [], params = [];
    let order = '', limit = '', select = '*';
    for (const [k, v] of searchParams) {
      if (k === 'select') {
        if (v !== '*') {
          const cols = v.split(',').map((s) => s.trim());
          if (!cols.every((c) => IDENT.test(c))) throw Object.assign(new Error('unsupported select'), { status: 400 });
          select = cols.map((c) => `"${c}"`).join(', ');
        }
      } else if (k === 'order') {
        const parts = v.split(',').map((p) => {
          const [col, dir] = p.split('.');
          if (!IDENT.test(col)) throw Object.assign(new Error('bad order'), { status: 400 });
          return `"${col}" ${dir === 'desc' ? 'desc' : 'asc'}`;
        });
        order = ` order by ${parts.join(', ')}`;
      } else if (k === 'limit') {
        limit = ` limit ${Math.min(1000, parseInt(v, 10) || 0)}`;
      } else if (k === 'columns' || k === 'offset') {
        // ignored
      } else {
        if (!IDENT.test(k)) throw Object.assign(new Error('bad filter column'), { status: 400 });
        const m = /^(eq|neq|in)\.(.*)$/s.exec(v);
        if (!m) throw Object.assign(new Error('unsupported filter ' + v), { status: 400 });
        if (m[1] === 'in') {
          const vals = m[2].replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).filter(Boolean);
          if (!vals.length) { where.push('false'); continue; }
          where.push(`"${k}"::text = any($${params.length + 1}::text[])`); params.push(vals);
        } else {
          where.push(`"${k}"::text ${m[1] === 'eq' ? '=' : '<>'} $${params.length + 1}`); params.push(m[2]);
        }
      }
    }
    return { where: where.length ? ' where ' + where.join(' and ') : '', params, order, limit, select };
  }

  function pgError(e) {
    const code = e.code || '';
    const status = code === '42501' ? (/row-level security/.test(e.message) ? 403 : 401) : code === '23505' ? 409 : code.startsWith('23') ? 409 : 400;
    return { status, body: { code, message: e.message, details: e.detail || null, hint: e.hint || null } };
  }

  async function handleRest(req, url, table, body) {
    const user = callerFrom(req);
    const f = parseFilters(url.searchParams);
    const prefer = req.headers.prefer || '';
    const wantRep = /return=representation/.test(prefer);
    const wantObject = /vnd\.pgrst\.object/.test(req.headers.accept || '');
    let result;
    if (req.method === 'GET' || req.method === 'HEAD') {
      result = await asCaller(user, `select ${f.select} from public.${table}${f.where}${f.order}${f.limit}`, f.params);
    } else if (req.method === 'POST') {
      const rows = Array.isArray(body) ? body : [body];
      const out = [];
      for (const row of rows) {
        const cols = Object.keys(row).filter((c) => IDENT.test(c));
        const vals = cols.map((c) => (row[c] !== null && typeof row[c] === 'object') ? JSON.stringify(row[c]) : row[c]);
        const r = await asCaller(user, `insert into public.${table} (${cols.map((c) => `"${c}"`).join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) returning ${f.select}`, vals);
        out.push(...r.rows);
      }
      result = { rows: out };
    } else if (req.method === 'PATCH') {
      const cols = Object.keys(body).filter((c) => IDENT.test(c));
      const vals = cols.map((c) => (body[c] !== null && typeof body[c] === 'object') ? JSON.stringify(body[c]) : body[c]);
      const shifted = f.where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + cols.length}`);
      result = await asCaller(user, `update public.${table} set ${cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ')}${shifted} returning ${f.select}`, [...vals, ...f.params]);
    } else if (req.method === 'DELETE') {
      result = await asCaller(user, `delete from public.${table}${f.where} returning ${f.select}`, f.params);
    } else {
      return { status: 405, body: { message: 'method not allowed' } };
    }
    const rows = result.rows;
    if (wantObject) {
      if (rows.length !== 1) return { status: 406, body: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows` } };
      return { status: req.method === 'POST' ? 201 : 200, body: rows[0] };
    }
    if (req.method === 'GET') return { status: 200, body: rows };
    if (!wantRep) return { status: req.method === 'POST' ? 201 : 204, body: null };
    return { status: req.method === 'POST' ? 201 : 200, body: rows };
  }

  async function handleAuth(req, url, body) {
    const p = url.pathname.replace('/auth/v1', '');
    if (p === '/signup' && req.method === 'POST') {
      const email = String(body.email || '').toLowerCase();
      if (users.has(email)) return { status: 422, body: { code: 'user_already_exists', msg: 'User already registered', message: 'User already registered' } };
      if (String(body.password || '').length < 6) return { status: 422, body: { code: 'weak_password', msg: 'Password should be at least 6 characters.', message: 'Password should be at least 6 characters.' } };
      const u = { id: crypto.randomUUID(), email, password: body.password, created_at: new Date().toISOString() };
      users.set(email, u);
      await serial(() => db.query('insert into auth.users (id, email) values ($1, $2)', [u.id, email]));
      return { status: 200, body: session(u) };                       // auto-confirm, like "Confirm email" switched off
    }
    if (p === '/token' && req.method === 'POST') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const u = users.get(String(body.email || '').toLowerCase());
        if (!u || u.password !== body.password) return { status: 400, body: { code: 'invalid_credentials', error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', message: 'Invalid login credentials' } };
        return { status: 200, body: session(u) };
      }
      if (grant === 'refresh_token') {
        const u = refresh.get(body.refresh_token);
        if (!u) return { status: 400, body: { code: 'refresh_token_not_found', msg: 'Invalid Refresh Token', message: 'Invalid Refresh Token' } };
        return { status: 200, body: session(u) };
      }
    }
    if (p === '/otp' && req.method === 'POST') { log.push({ otp: body.email }); return { status: 200, body: {} }; }
    if (p === '/user' && req.method === 'GET') {
      const u = callerFrom(req);
      return u ? { status: 200, body: userJson(u) } : { status: 401, body: { code: 'bad_jwt', msg: 'invalid JWT', message: 'invalid JWT' } };
    }
    if (p === '/logout' && req.method === 'POST') return { status: 204, body: null };
    return { status: 404, body: { message: 'not emulated: ' + p } };
  }

  const server = http.createServer(async (req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': req.headers.origin || '*', 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS,HEAD',
      'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*',
      'Access-Control-Expose-Headers': 'Content-Range, X-Supabase-Api-Version',
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; } catch { body = {}; }
    const url = new URL(req.url, `http://localhost:${port}`);
    let out;
    try {
      if (url.pathname.startsWith('/auth/v1')) out = await handleAuth(req, url, body);
      else if (url.pathname.startsWith('/rest/v1/')) {
        const table = url.pathname.slice('/rest/v1/'.length);
        out = TABLES.has(table) ? await handleRest(req, url, table, body) : { status: 404, body: { code: '42P01', message: `relation "public.${table}" does not exist` } };
      } else out = { status: 404, body: { message: 'not emulated' } };
    } catch (e) {
      out = e.status ? { status: e.status, body: { message: e.message } } : pgError(e);
    }
    log.push({ method: req.method, path: url.pathname + url.search, status: out.status });
    res.writeHead(out.status, { ...cors, 'Content-Type': 'application/json' });
    res.end(out.body === null ? '' : JSON.stringify(out.body));
  });
  await new Promise((r) => server.listen(port, r));
  return { server, db, users, log, url: `http://localhost:${port}`, close: () => new Promise((r) => server.close(r)) };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const port = Number(process.argv[2]) || 54321;
  await startMock(port);
  console.log(`Mock Supabase (PGlite + real RLS) on http://localhost:${port}`);
}
