// Almacenamiento de cuentas, sesiones y perfiles. Misma interfaz (todo async), dos implementaciones:
//  - archivo JSON local (por defecto): ideal para tu PC, Docker o un servidor con disco;
//  - Redis por REST (Upstash / Vercel KV): necesario en Vercel, donde no hay disco permanente.
// Se elige solo: si existen UPSTASH_REDIS_REST_URL+TOKEN (o KV_REST_API_URL+TOKEN) se usa Redis.
import fs from 'node:fs';
import path from 'node:path';

const SESSION_TTL_S = 30 * 86400;

export function fileStore(file) {
  let DB = { users: {}, sessions: {} };
  try { DB = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  DB.users ??= {}; DB.sessions ??= {};
  let dirty = null; // escritura agrupada: varios cambios seguidos = una sola escritura atómica
  const flush = () => {
    if (!dirty) return; clearTimeout(dirty); dirty = null;
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(DB)); fs.renameSync(file + '.tmp', file); }
    catch (e) { console.error('[db]', e.message); }
  };
  const persist = () => { dirty ??= setTimeout(flush, 250); };
  process.on('exit', flush);
  const counters = new Map(), tokens = new Map(); // contadores y tokens de corta vida: viven en memoria (en tu PC hay una sola instancia)
  return {
    kind: 'file', flush,
    async incr(key, ttlSec) { // contador con vencimiento (límites de peticiones)
      const now = Date.now(), c = counters.get(key);
      if (!c || c.exp <= now) { counters.set(key, { n: 1, exp: now + ttlSec * 1000 }); return 1; }
      return ++c.n;
    },
    async count(key) { const c = counters.get(key); return c && c.exp > Date.now() ? c.n : 0; },
    async cacheGet() { return null; }, async cacheSet() {}, // la caché compartida solo tiene sentido con Redis
    async putToken(kind, id, data, ttlSec) { tokens.set(kind + ':' + id, { data, exp: Date.now() + ttlSec * 1000 }); },
    async takeToken(kind, id) { const k = kind + ':' + id, t = tokens.get(k); tokens.delete(k); return t && t.exp > Date.now() ? t.data : null; },
    async setPassword(email, salt, hash) { const u = DB.users[email]; if (u) { u.salt = salt; u.hash = hash; persist(); } },
    async delUserSessions(email) { for (const [k, v] of Object.entries(DB.sessions)) if (v.uid === email) delete DB.sessions[k]; persist(); },
    async deleteUser(email) { delete DB.users[email]; await this.delUserSessions(email); persist(); },
    async getUser(email) { const u = DB.users[email]; return u ? { name: u.name, salt: u.salt, hash: u.hash } : null; },
    async createUser(email, u) { if (DB.users[email]) return false; DB.users[email] = { ...u, profile: null }; persist(); return true; },
    async getProfile(email) { return DB.users[email]?.profile ?? null; },
    async putProfile(email, p) { if (DB.users[email]) { DB.users[email].profile = p; persist(); } },
    async getSession(id) { return DB.sessions[id] ?? null; },
    async putSession(id, s) {
      for (const [k, v] of Object.entries(DB.sessions)) if (v.exp < Date.now()) delete DB.sessions[k];
      DB.sessions[id] = s; persist();
    },
    async delSession(id) { delete DB.sessions[id]; persist(); }
  };
}

export function redisStore(url, token, fetchFn = (...a) => fetch(...a)) {
  const cmd = async (...args) => {
    const r = await fetchFn(url.replace(/\/$/, ''), { method: 'POST', signal: AbortSignal.timeout(6000),
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error('Redis: ' + (d.error || r.status));
    return d.result;
  };
  const get = async k => { const v = await cmd('GET', k); try { return v ? JSON.parse(v) : null; } catch { return null; } };
  const U = e => 'pulso:user:' + e, P = e => 'pulso:profile:' + e, S = id => 'pulso:sess:' + id, US = e => 'pulso:usess:' + e;
  return {
    kind: 'redis',
    getUser: email => get(U(email)),
    async createUser(email, u) { return (await cmd('SET', U(email), JSON.stringify(u), 'NX')) === 'OK'; }, // NX: dos registros a la vez no se pisan
    getProfile: email => get(P(email)),
    async putProfile(email, p) { await cmd('SET', P(email), JSON.stringify(p)); },
    getSession: id => get(S(id)),
    async putSession(id, s) {
      await cmd('SET', S(id), JSON.stringify(s), 'EX', SESSION_TTL_S); // las sesiones vencen solas
      if (s.uid) { await cmd('SADD', US(s.uid), id); await cmd('EXPIRE', US(s.uid), SESSION_TTL_S); } // índice para "cerrar sesión en todos los dispositivos"
    },
    async delSession(id) { await cmd('DEL', S(id)); },
    async delUserSessions(email) { const ids = (await cmd('SMEMBERS', US(email))) || []; for (const id of ids) await cmd('DEL', S(id)); await cmd('DEL', US(email)); },
    async deleteUser(email) { await this.delUserSessions(email); await cmd('DEL', U(email)); await cmd('DEL', P(email)); },
    async setPassword(email, salt, hash) { const u = await get(U(email)); if (u) await cmd('SET', U(email), JSON.stringify({ ...u, salt, hash })); },
    // Contadores compartidos entre todas las instancias (límites de peticiones): INCR y, la primera vez, EXPIRE.
    async count(key) { return Number(await cmd('GET', 'pulso:rl:' + key)) || 0; },
    async incr(key, ttlSec) { const n = await cmd('INCR', 'pulso:rl:' + key); if (n === 1) await cmd('EXPIRE', 'pulso:rl:' + key, ttlSec); return n; },
    // Caché compartida de respuestas de APIs externas (todas las instancias la ven).
    cacheGet: key => get('pulso:cache:' + key),
    async cacheSet(key, value, ttlSec) { await cmd('SET', 'pulso:cache:' + key, JSON.stringify(value), 'EX', Math.max(1, Math.round(ttlSec))); },
    // Tokens de un solo uso (recuperar contraseña): se guardan con su hash y vencen solos.
    async putToken(kind, id, data, ttlSec) { await cmd('SET', 'pulso:tok:' + kind + ':' + id, JSON.stringify(data), 'EX', ttlSec); },
    async takeToken(kind, id) { const k = 'pulso:tok:' + kind + ':' + id, v = await get(k); if (v) await cmd('DEL', k); return v; }
  };
}

export function createStore({ file, env = process.env, fetchFn } = {}) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL, token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token) return redisStore(url, token, fetchFn);
  if (env.VERCEL) console.warn('[db] Sin Redis configurado: en Vercel las cuentas se pierden al reiniciar. Ver README → "Desplegar en Vercel".');
  return fileStore(file);
}
