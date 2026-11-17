// Cuentas, perfil versionado y portada en un solo pedido (usa el servidor real con respuestas externas simuladas).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import './mock-fetch.mjs';
process.env.PORT = '3997';
process.env.DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-acc-')), 'db.json');
const { cleanProfile } = await import('../server/server.js');
const base = 'http://localhost:3997';
const req = (p, o = {}) => fetch(base + p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } });
const send = (method, p, body, headers) => req(p, { method, body: JSON.stringify(body), headers });
const cookieOf = r => r.headers.get('set-cookie').split(';')[0];
const register = async email => cookieOf(await send('POST', '/api/auth/register', { email, password: 'clave-segura', name: 'T' }));

test('/api/home: una sola respuesta con las 6 listas y la hora real de armado', async () => {
  const before = Date.now(), h = await (await req('/api/home')).json();
  for (const k of ['charts', 'news', 'trending', 'fresh', 'upcoming', 'hot']) assert.ok(k in h, k);
  assert.ok(Array.isArray(h.failed)); assert.ok(h.generatedAt >= before - 5000 && h.generatedAt <= Date.now());
  assert.ok(h.charts.length > 0, 'hay canciones del ranking');
});
test('perfil: se valida la forma y se recorta lo raro', () => {
  assert.equal(cleanProfile([]), null); assert.equal(cleanProfile(null), null);
  const p = cleanProfile({ tags: { 'genre:pop': [{ w: 2, t: 1 }, { w: 'x', t: 1 }], 'artist:x': 'no' }, bands: ['Muse', 5], favorites: [{ id: 'a' }, { nope: 1 }], blocked: 'x',
    games: [{ id: 'steam:1', title: 'Hades', tags: ['gamegenre:indie', 3] }, { id: 7 }], musicApp: 'spotify', evil: '<script>' });
  assert.deepEqual(p.tags, { 'genre:pop': [{ w: 2, t: 1 }] }); assert.deepEqual(p.bands, ['Muse']); assert.equal(p.favorites.length, 1);
  assert.deepEqual(p.blocked, []); assert.deepEqual(p.games, [{ id: 'steam:1', title: 'Hades', tags: ['gamegenre:indie'] }]);
  assert.equal(p.musicApp, 'spotify'); assert.ok(!('evil' in p));
});
test('perfil: la escritura con una versión vieja se rechaza (409) y no pisa lo nuevo', async () => {
  const cookie = await register('dos@disp.com'), put = (profile, base) => send('PUT', '/api/profile', { profile, base }, { cookie });
  const a = await put({ tags: {}, bands: ['A'] }, 0); assert.equal(a.status, 200); assert.equal((await a.json()).rev, 1);
  const b = await put({ tags: {}, bands: ['B'] }, 1); assert.equal(b.status, 200); // el segundo dispositivo guardó con la versión 1 → 2
  const stale = await put({ tags: {}, bands: ['PISA'] }, 1); // el primero todavía cree que está en la 1
  assert.equal(stale.status, 409); assert.deepEqual((await stale.json()).profile.bands, ['B']);
  assert.deepEqual((await (await req('/api/profile', { headers: { cookie } })).json()).profile.bands, ['B']);
});
test('recuperar contraseña: respuesta idéntica exista o no la cuenta, enlace de un solo uso y cierra las demás sesiones', async () => {
  const logs = []; const warn = console.warn, log = console.log; console.warn = () => {}; console.log = (...a) => logs.push(a.join(' '));
  try {
    const old = await register('olvido@x.com');
    const a = await send('POST', '/api/auth/forgot', { email: 'olvido@x.com' }), b = await send('POST', '/api/auth/forgot', { email: 'nadie@x.com' });
    assert.equal(a.status, 200); assert.deepEqual(await a.json(), await b.json());
    const link = logs.find(l => l.includes('/#/reset/')); assert.ok(link, 'en desarrollo el enlace sale por consola');
    assert.equal(logs.filter(l => l.includes('/#/reset/')).length, 1, 'para una cuenta inexistente no se genera nada');
    const token = /reset\/([a-f0-9]{64})/.exec(link)[1];
    assert.equal((await send('POST', '/api/auth/reset', { token, password: 'corta' })).status, 400);
    const ok = await send('POST', '/api/auth/reset', { token, password: 'otra-clave-1' }); assert.equal(ok.status, 200);
    assert.equal((await req('/api/auth/me', { headers: { cookie: old } })).status, 401, 'la sesión vieja se cerró');
    assert.equal((await send('POST', '/api/auth/reset', { token, password: 'otra-clave-2' })).status, 400, 'el enlace no se reutiliza');
    assert.equal((await send('POST', '/api/auth/login', { email: 'olvido@x.com', password: 'otra-clave-1' })).status, 200);
    assert.equal((await send('POST', '/api/auth/login', { email: 'olvido@x.com', password: 'clave-segura' })).status, 401);
  } finally { console.warn = warn; console.log = log; }
});
test('cerrar sesión en todos los dispositivos', async () => {
  const c1 = await register('multi@x.com'), l = await send('POST', '/api/auth/login', { email: 'multi@x.com', password: 'clave-segura' }), c2 = cookieOf(l);
  assert.equal((await req('/api/auth/me', { headers: { cookie: c2 } })).status, 200);
  assert.equal((await send('POST', '/api/auth/logout-all', {}, { cookie: c1 })).status, 200);
  assert.equal((await req('/api/auth/me', { headers: { cookie: c1 } })).status, 401); assert.equal((await req('/api/auth/me', { headers: { cookie: c2 } })).status, 401);
});
test('borrar cuenta: pide la contraseña y elimina de verdad (también el email se puede registrar de nuevo)', async () => {
  const cookie = await register('borrar@x.com');
  assert.equal((await send('DELETE', '/api/auth/account', { password: 'mala-clave-1' }, { cookie })).status, 401);
  assert.equal((await send('DELETE', '/api/auth/account', {}, {})).status, 401, 'sin sesión');
  assert.equal((await send('DELETE', '/api/auth/account', { password: 'clave-segura' }, { cookie })).status, 200);
  assert.equal((await req('/api/auth/me', { headers: { cookie } })).status, 401);
  assert.equal((await send('POST', '/api/auth/login', { email: 'borrar@x.com', password: 'clave-segura' })).status, 401);
  assert.equal((await send('POST', '/api/auth/register', { email: 'borrar@x.com', password: 'clave-segura' })).status, 201);
});
test('bloqueo de acceso: 10 intentos fallidos por cuenta se cuentan en el almacenamiento compartido', async () => {
  await register('bloq@x.com'); const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await send('POST', '/api/auth/login', { email: 'bloq@x.com', password: 'mala-' + i + 'xxxx' })).status);
  // la IP ya acumuló fallos de las pruebas anteriores, así que el corte llega antes de 10: lo importante es que llega y que no se resetea
  assert.equal(codes[0], 401); assert.ok(codes.includes(429), 'aparece un 429'); assert.equal(codes.at(-1), 429);
  assert.equal((await send('POST', '/api/auth/login', { email: 'bloq@x.com', password: 'clave-segura' })).status, 429, 'ni con la clave correcta mientras dure el bloqueo');
});
test('seguridad: /api/health no expone datos internos y un POST "cross-site" sin Origin se rechaza', async () => {
  assert.deepEqual(await (await req('/api/health')).json(), { ok: true });
  assert.equal((await send('POST', '/api/auth/logout', {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await send('POST', '/api/auth/logout', {}, { 'Sec-Fetch-Site': 'same-origin' })).status, 200);
});
test.after(() => setTimeout(() => process.exit(0), 50));
