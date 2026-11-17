// Prueba de humo posterior al despliegue: pide las páginas y endpoints básicos y falla si algo no responde como se espera.
// Uso:  BASE_URL=https://tu-proyecto.vercel.app npm run smoke   (o:  node scripts/smoke.mjs https://tu-proyecto.vercel.app)
const base = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function check(name, path, ok) {
  let last;
  for (let i = 0; i < 4; i++) { // el primer pedido a una función nueva puede tardar o fallar mientras "despierta"
    try {
      const r = await fetch(base + path, { signal: AbortSignal.timeout(20000) }), body = await r.text();
      if (r.ok && ok(body, r)) return console.log('✓', name);
      last = `HTTP ${r.status}`;
    } catch (e) { last = e.message; }
    await sleep(3000);
  }
  console.error('✗', name, '→', last); process.exitCode = 1;
}
await check('portada (/)', '/', b => b.includes('Pulso') && b.includes('id="view"'));
await check('manifest', '/manifest.webmanifest', b => JSON.parse(b).name === 'Pulso');
await check('privacidad', '/privacidad.html', b => b.includes('Privacidad'));
await check('/api/health', '/api/health', b => JSON.parse(b).ok === true);
await check('/api/home', '/api/home', b => { const d = JSON.parse(b); return typeof d.generatedAt === 'number' && Array.isArray(d.failed); });
await check('/api/config', '/api/config', b => 'yt' in JSON.parse(b));
if (process.exitCode) console.error('Prueba de humo FALLÓ en', base); else console.log('Todo bien en', base);
