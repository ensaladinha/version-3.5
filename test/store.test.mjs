// Pruebas del almacenamiento (no necesitan servidor ni internet).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore, fileStore, redisStore } from '../server/store.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-store-')), 'db.json');

test('archivo: crea usuario una sola vez, guarda perfil y sesión, y sobrevive a un reinicio', async () => {
  const file = tmp(), a = fileStore(file);
  assert.equal(await a.createUser('ana@x.com', { name: 'Ana', salt: 's', hash: 'h' }), true);
  assert.equal(await a.createUser('ana@x.com', { name: 'Otra', salt: 's', hash: 'h' }), false);
  await a.putProfile('ana@x.com', { tags: { a: 1 } });
  await a.putSession('sid1', { uid: 'ana@x.com', exp: Date.now() + 1e6 });
  a.flush();
  const b = fileStore(file); // "reinicio": se vuelve a leer del disco
  assert.equal((await b.getUser('ana@x.com')).name, 'Ana');
  assert.deepEqual(await b.getProfile('ana@x.com'), { tags: { a: 1 } });
  assert.equal((await b.getSession('sid1')).uid, 'ana@x.com');
  await b.delSession('sid1'); assert.equal(await b.getSession('sid1'), null);
  assert.equal(await b.getUser('nadie@x.com'), null);
});
test('archivo: getUser no filtra el perfil y las sesiones vencidas se limpian', async () => {
  const s = fileStore(tmp());
  await s.createUser('a@x.com', { name: 'A', salt: 's', hash: 'h' });
  assert.equal('profile' in (await s.getUser('a@x.com')), false);
  await s.putSession('viejo', { uid: 'a@x.com', exp: Date.now() - 1 });
  await s.putSession('nuevo', { uid: 'a@x.com', exp: Date.now() + 1e6 });
  assert.equal(await s.getSession('viejo'), null);
});
test('redis: manda los comandos correctos (NX al crear, EX en sesiones) y lee JSON', async () => {
  const kv = new Map(), sent = [];
  const fake = async (url, init) => {
    const [c, k, v, ...rest] = JSON.parse(init.body); sent.push([c, k, ...rest]);
    assert.equal(init.headers.Authorization, 'Bearer tok');
    let result = null;
    if (c === 'SET') { if (rest[0] === 'NX' && kv.has(k)) result = null; else { kv.set(k, v); result = 'OK'; } }
    else if (c === 'GET') result = kv.get(k) ?? null; else if (c === 'DEL') { result = +kv.delete(k); }
    return { ok: true, json: async () => ({ result }) };
  };
  const s = redisStore('https://r.example/', 'tok', fake);
  assert.equal(await s.createUser('a@x.com', { name: 'A', salt: 's', hash: 'h' }), true);
  assert.equal(await s.createUser('a@x.com', { name: 'B', salt: 's', hash: 'h' }), false);
  assert.equal((await s.getUser('a@x.com')).name, 'A');
  await s.putProfile('a@x.com', { x: 1 }); assert.deepEqual(await s.getProfile('a@x.com'), { x: 1 });
  await s.putSession('id', { uid: 'a@x.com', exp: 1 });
  assert.ok(sent.some(c => c[0] === 'SET' && c[2] === 'EX'), 'la sesión vence sola');
  await s.delSession('id'); assert.equal(await s.getSession('id'), null);
});
test('redis: un error del servicio se propaga (no se confunde con "sin datos")', async () => {
  const s = redisStore('https://r.example', 't', async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }));
  await assert.rejects(() => s.getUser('a@x.com'), /Redis/);
});
test('createStore elige Redis solo si hay URL y token (Upstash o Vercel KV)', () => {
  assert.equal(createStore({ file: tmp(), env: {} }).kind, 'file');
  assert.equal(createStore({ file: tmp(), env: { UPSTASH_REDIS_REST_URL: 'u' } }).kind, 'file');
  assert.equal(createStore({ file: tmp(), env: { UPSTASH_REDIS_REST_URL: 'u', UPSTASH_REDIS_REST_TOKEN: 't' } }).kind, 'redis');
  assert.equal(createStore({ file: tmp(), env: { KV_REST_API_URL: 'u', KV_REST_API_TOKEN: 't' } }).kind, 'redis');
});

test('archivo: contadores con vencimiento, tokens de un solo uso, cambio de contraseña y borrado de cuenta', async () => {
  const s = fileStore(tmp());
  assert.equal(await s.incr('k', 60), 1); assert.equal(await s.incr('k', 60), 2); assert.equal(await s.count('k'), 2); assert.equal(await s.count('otra'), 0);
  await s.putToken('reset', 'h1', { email: 'a@x.com' }, 60);
  assert.deepEqual(await s.takeToken('reset', 'h1'), { email: 'a@x.com' }); assert.equal(await s.takeToken('reset', 'h1'), null);
  await s.createUser('a@x.com', { name: 'A', salt: 's', hash: 'h' }); await s.putProfile('a@x.com', { x: 1 });
  await s.putSession('s1', { uid: 'a@x.com', exp: Date.now() + 1e6 }); await s.putSession('s2', { uid: 'b@x.com', exp: Date.now() + 1e6 });
  await s.setPassword('a@x.com', 's2', 'h2'); assert.equal((await s.getUser('a@x.com')).hash, 'h2');
  await s.delUserSessions('a@x.com'); assert.equal(await s.getSession('s1'), null); assert.ok(await s.getSession('s2'));
  await s.deleteUser('a@x.com'); assert.equal(await s.getUser('a@x.com'), null); assert.equal(await s.getProfile('a@x.com'), null);
});
test('redis: INCR + EXPIRE en el primer golpe, caché con EX, índice de sesiones y borrado de cuenta', async () => {
  const kv = new Map(), sets = new Map(), sent = [];
  const fake = async (_u, init) => {
    const [c, k, ...r] = JSON.parse(init.body); sent.push([c, k, ...r]); let result = null;
    if (c === 'INCR') { kv.set(k, (+kv.get(k) || 0) + 1); result = +kv.get(k); }
    else if (c === 'GET') result = kv.get(k) ?? null;
    else if (c === 'SET') { kv.set(k, r[0]); result = 'OK'; }
    else if (c === 'DEL') result = +kv.delete(k);
    else if (c === 'SADD') { (sets.get(k) || sets.set(k, new Set()).get(k)).add(r[0]); result = 1; }
    else if (c === 'SMEMBERS') result = [...(sets.get(k) || [])];
    else result = 1;
    return new Response(JSON.stringify({ result }), { status: 200 });
  };
  const s = redisStore('https://r.example', 'tok', fake);
  assert.equal(await s.incr('lim', 60), 1); assert.equal(await s.incr('lim', 60), 2);
  assert.equal(sent.filter(x => x[0] === 'EXPIRE').length, 1, 'EXPIRE solo la primera vez'); assert.equal(await s.count('lim'), 2);
  await s.cacheSet('home', { a: 1 }, 120); assert.deepEqual(await s.cacheGet('home'), { a: 1 });
  assert.deepEqual(sent.find(x => x[0] === 'SET' && x[1] === 'pulso:cache:home').slice(2), ['{"a":1}', 'EX', 120]);
  await s.createUser('a@x.com', { name: 'A', salt: 's', hash: 'h' }); await s.putSession('sidA', { uid: 'a@x.com', exp: 1 }); await s.putSession('sidB', { uid: 'a@x.com', exp: 1 });
  await s.putToken('reset', 'tk', { email: 'a@x.com' }, 3600); assert.deepEqual(await s.takeToken('reset', 'tk'), { email: 'a@x.com' }); assert.equal(await s.takeToken('reset', 'tk'), null);
  await s.deleteUser('a@x.com'); assert.equal(await s.getSession('sidA'), null); assert.equal(await s.getSession('sidB'), null); assert.equal(await s.getUser('a@x.com'), null);
});
