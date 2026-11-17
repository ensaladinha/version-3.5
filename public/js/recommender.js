// Recomendador basado en contenido. Es determinista: mismo perfil + mismos ítems = mismo feed durante el día.
// Cada interacción (like, click, reproducción, saltar, "no me interesa") suma o resta peso a las etiquetas del ítem.
const HALF_LIFE_DAYS = 30, DAY = 86_400_000;
export const decay = (w, t, now = Date.now()) => w * Math.pow(0.5, (now - t) / DAY / HALF_LIFE_DAYS);
const tagSum = (tag, p, now) => (p.tags[tag] ?? []).reduce((a, e) => a + decay(e.w, e.t, now), 0);
// Peso actual de una etiqueta (suma de eventos con decaimiento): es el "puntaje" que se va ajustando con cada interacción.
export const weight = (tag, p, now = Date.now()) => tagSum(tag, p, now);
const known = (tag, p) => (p.tags[tag]?.length ?? 0) > 0;
export const affinity = (item, p, now = Date.now()) => Math.tanh((item.tags ?? []).reduce((s, t) => s + tagSum(t, p, now), 0) / 10);
// Desempate pseudoaleatorio pero estable durante el día (no parpadea al recargar)
const jitter = (id, now) => { let h = 2166136261 ^ Math.floor(now / DAY); for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 1000) / 1000; };
function freshness(item, now) {
  if (!item.publishedAt) return 0.3;
  const days = (now - item.publishedAt) / DAY;
  if (days < 0) return -days <= 14 ? 0.8 : 0.3; // los estrenos cercanos suben; los lejanos no dominan el feed
  return Math.max(0, 1 - days / (item.type === 'news' ? 7 : 30));
}
// Bonos por combinación: "terror" + "PC" juntos pesan más que cada gusto por separado, y una canción de un artista
// parecido a una banda que le gusta (item.via) sube aunque el artista todavía sea desconocido para el usuario.
const GENRE_PREFIX = ['genre:', 'gamegenre:', 'mediagenre:'];
const liked = (t, p, now) => tagSum(t, p, now) > 0.5;
const combo = (item, p, now) => { const t = item.tags ?? [];
  return t.some(x => x.startsWith('platform:') && liked(x, p, now)) && t.some(x => GENRE_PREFIX.some(g => x.startsWith(g)) && liked(x, p, now)) ? 1 : 0; };
const viaBonus = (item, p, now) => item.via && liked('artist:' + item.via, p, now) ? 1 : 0;
export const score = (item, p, now = Date.now()) =>
  0.55 * (affinity(item, p, now) + 1) / 2 + 0.2 * (item.popularity ?? 0) + 0.2 * freshness(item, now) + 0.05 * jitter(item.id, now)
  + 0.15 * combo(item, p, now) + 0.1 * viaBonus(item, p, now);
const vetoed = (it, p, now) => affinity(it, p, now) < -0.4; // lo que el usuario rechazó no vuelve ni como "descubrimiento"
const artistOf = it => (it.tags ?? []).find(t => t.startsWith('artist:'));
const sharesTag = (a, b) => (a.tags ?? []).some(t => (b.tags ?? []).includes(t));
// "Para vos": mejor puntaje, con penalización por repetir artista o etiquetas para que el feed sea variado
export function buildFeed(items, p, size = 20) {
  const now = Date.now(), pool = items.filter(i => !vetoed(i, p, now)).map(i => ({ i, s: score(i, p, now) })), out = [];
  while (out.length < size && pool.length) {
    let bk = 0, bv = -Infinity;
    pool.forEach((c, k) => { const v = c.s - out.reduce((a, o) => a + (artistOf(o) && artistOf(o) === artistOf(c.i) ? 0.15 : sharesTag(o, c.i) ? 0.03 : 0), 0); if (v > bv) { bv = v; bk = k; } });
    out.push(pool.splice(bk, 1)[0].i);
  }
  return out;
}
// "Descubrí algo nuevo": ítems con etiquetas que el usuario aún no conoce, priorizando los que tienen algún puente con lo que le gusta
export function discover(items, p, size = 8, skip = new Set()) {
  const now = Date.now(), artists = new Set(), out = [];
  const ranked = items.filter(i => !skip.has(i.id) && !vetoed(i, p, now) && !p.favorites?.some(f => f.id === i.id)).map(i => {
    const tags = i.tags ?? [], nov = tags.length ? tags.filter(t => !known(t, p)).length / tags.length : 1;
    const bridge = tags.some(t => tagSum(t, p, now) > 0.5) ? 0.4 : 0;
    return { i, s: nov ? nov * (0.5 + 0.5 * (i.popularity ?? 0)) + bridge + 0.05 * jitter(i.id, now) : -1 };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  for (const { i } of ranked) { const a = artistOf(i); if (a && artists.has(a)) continue; a && artists.add(a); out.push(i); if (out.length >= size) break; }
  return out;
}
// Texto de "por qué te lo mostramos". label(tag) convierte una etiqueta en palabras legibles.
export function why(item, p, label = t => t.split(':').slice(1).join(':')) {
  const now = Date.now();
  if (item.via && liked('artist:' + item.via, p, now)) return 'Parecido a ' + label('artist:' + item.via);
  let g = null, gw = 0.5, pl = null, pw = 0.5, o = null, ow = 0.5;
  for (const t of item.tags ?? []) {
    const w = tagSum(t, p, now);
    if (t.startsWith('platform:')) { if (w > pw) { pw = w; pl = t; } }
    else if (GENRE_PREFIX.some(x => t.startsWith(x))) { if (w > gw) { gw = w; g = t; } }
    else if (w > ow) { ow = w; o = t; }
  }
  if (g && pl) return `Porque te gusta: ${label(g)} en ${label(pl)}`;
  const best = o && ow >= gw ? o : g || o; // un artista que le gusta explica mejor que su género
  return best ? 'Porque te gusta: ' + label(best) : '';
}
