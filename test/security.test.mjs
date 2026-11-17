import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { calls } from './mock-fetch.mjs';
process.env.PORT = '3998';
process.env.YT_KEY = 'clave-de-prueba';
process.env.YT_MUSIC = '1'; // la música completa en YouTube es opt-in (gasta cuota)
process.env.DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-')), 'db.json');
await import('../server/server.js');
const base = 'http://localhost:3998';
const req = (p, o = {}) => fetch(base + p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } });
const post = (p, body, headers) => req(p, { method: 'POST', body: JSON.stringify(body), headers });

test('cabeceras de seguridad y CSP sin estilos ni scripts en línea', async () => {
  const r = await fetch(base + '/');
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/); assert.match(csp, /frame-ancestors 'none'/); assert.match(csp, /object-src 'none'/);
  assert.ok(!/unsafe-inline|unsafe-eval/.test(csp), 'sin unsafe-inline');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-powered-by'), null);
});
test('el HTML y los módulos no usan manejadores ni estilos en línea (compatibles con la CSP)', () => {
  const dir = path.join(import.meta.dirname, '../public');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.ok(!/\son\w+\s*=/.test(html) && !/\sstyle\s*=/.test(html));
  for (const f of fs.readdirSync(path.join(dir, 'js'))) {
    const js = fs.readFileSync(path.join(dir, 'js', f), 'utf8');
    assert.ok(!/\son(error|click|load)\s*=\s*"/.test(js), f + ' tiene un manejador en línea');
    assert.ok(!/style="/.test(js), f + ' tiene estilo en línea');
  }
});
test('SEO: descripción, favicon y manifest', () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, '../public/index.html'), 'utf8');
  for (const s of ['name="description"', 'rel="icon"', 'rel="manifest"', 'og:title', 'lang="es"', 'class="skip"']) assert.ok(html.includes(s), s);
});
test('YouTube: parámetros de más no esquivan la caché ni gastan cuota', async () => {
  const yt = () => calls.filter(u => u.includes('googleapis.com')).length, before = yt();
  for (const x of [1, 2, 3]) assert.equal((await req(`/api/music/resolve?artist=Muse&title=Starlight&x=${x}`)).status, 200);
  assert.equal(yt() - before, 1, 'una sola búsqueda a YouTube');
  assert.equal((await req('/api/music/resolve?artist=MUSE&title=starlight')).status, 200); // mayúsculas: misma llave
  assert.equal(yt() - before, 1);
});
test('YouTube: si la API falla se responde sin video y no se reintenta enseguida', async () => {
  const body = await (await req('/api/trailer?q=Algo')).json();
  assert.equal(body.videoId, null);
  const n = calls.length; await req('/api/trailer?q=Algo&y=2'); assert.equal(calls.length, n);
});
test('YouTube: límite de 20 búsquedas por minuto por IP', async () => {
  const codes = []; for (let i = 0; i < 25; i++) codes.push((await req('/api/trailer?q=distinto' + i)).status);
  assert.ok(codes.includes(429), 'aparece un 429'); assert.ok(codes.slice(0, 5).every(c => c === 200));
});
test('registro: valida email y contraseña (mín. 8)', async () => {
  assert.equal((await post('/api/auth/register', { email: 'malo', password: 'secreto123' })).status, 400);
  const r = await post('/api/auth/register', { email: 'a@b.com', password: '1234567' });
  assert.equal(r.status, 400); assert.equal((await r.json()).field, 'password');
});
let cookie;
test('registro + sesión + perfil', async () => {
  const r = await post('/api/auth/register', { email: 'Ana@Ejemplo.com', password: 'clave-segura', name: 'Ana' });
  assert.equal(r.status, 201);
  const sc = r.headers.get('set-cookie'); assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Lax/);
  cookie = sc.split(';')[0];
  assert.equal((await req('/api/auth/me', { headers: { cookie } })).status, 200);
  assert.equal((await req('/api/profile', { method: 'PUT', body: JSON.stringify({ profile: { tags: {} } }), headers: { cookie } })).status, 200);
  assert.equal((await req('/api/profile', { method: 'PUT', body: JSON.stringify({ profile: [] }), headers: { cookie } })).status, 400);
  assert.equal((await post('/api/auth/register', { email: 'ana@ejemplo.com', password: 'clave-segura' })).status, 409);
});
test('login: mismo mensaje exista o no la cuenta (no se puede enumerar emails)', async () => {
  const a = await post('/api/auth/login', { email: 'ana@ejemplo.com', password: 'incorrecta1' });
  const b = await post('/api/auth/login', { email: 'nadie@ejemplo.com', password: 'incorrecta1' });
  assert.equal(a.status, 401); assert.equal(b.status, 401);
  assert.deepEqual(await a.json(), await b.json());
  assert.equal((await post('/api/auth/login', { email: 'ana@ejemplo.com', password: 'clave-segura' })).status, 200);
});
test('CSRF: un POST con otro Origin se rechaza', async () => {
  const r = await post('/api/auth/logout', {}, { Origin: 'https://sitio-malo.example' });
  assert.equal(r.status, 403);
  assert.equal((await post('/api/auth/logout', {}, { Origin: base })).status, 200);
});
test('errores limpios: JSON inválido, demasiado grande y ruta inexistente', async () => {
  const bad = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{no es json' });
  assert.equal(bad.status, 400); assert.ok(!(await bad.text()).includes('at '), 'sin rastro de pila');
  const big = await post('/api/auth/login', { email: 'x@y.com', password: 'a'.repeat(300000) });
  assert.equal(big.status, 413);
  assert.equal((await req('/api/no-existe')).status, 404);
});
test('health', async () => { const h = await (await req('/api/health')).json(); assert.equal(h.ok, true); });
test.after(() => setTimeout(() => process.exit(0), 50));
