import test from 'node:test';
import assert from 'node:assert/strict';
import './mock-fetch.mjs';
process.env.PORT = '3999';
const { parseRss, mix } = await import('../server/personal.js');
const shared = await import('../public/js/shared.js');
const rec = await import('../public/js/recommender.js');
await import('../server/server.js');
const get = async p => (await fetch('http://localhost:3999/api/' + p)).json();
const now = Date.now(), prof = tags => ({ tags: Object.fromEntries(Object.entries(tags).map(([k, w]) => [k, [{ w, t: now }]])) });

test('etiquetas: iTunes en español se normaliza y los dominios no se mezclan', () => {
  assert.deepEqual(shared.musicGenreTags('Música latina'), ['genre:latin']);
  assert.deepEqual(shared.musicGenreTags('Pop latino').sort(), ['genre:latin', 'genre:pop']);
  assert.ok(shared.artistTags('Drake & Future').includes('artist:future'));
  assert.deepEqual(shared.gameTagsFromText('Nuevo juego de terror para PC y Xbox').sort(), ['gamegenre:terror', 'platform:pc', 'platform:xbox']);
  assert.deepEqual(shared.mediaGenreTags('Terror'), ['mediagenre:terror']);
  assert.equal(shared.steamGenreTag('Acción'), 'gamegenre:acción');
});
test('RSS: CDATA, entidades e imagen', () => {
  const [a] = parseRss(`<rss><channel><item><title><![CDATA[Hola &amp; chau]]></title><link>https://a.com/x</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Texto &lt;b&gt;largo&lt;/b&gt;&lt;img src="https://i.com/a.jpg"&gt;&lt;/p&gt;</description></item></channel></rss>`);
  assert.equal(a.title, 'Hola & chau'); assert.equal(a.summary, 'Texto largo'); assert.equal(a.image, 'https://i.com/a.jpg'); assert.ok(a.publishedAt);
  assert.equal(parseRss('<item><title>x</title><link>javascript:alert(1)</link></item>').length, 0);
});
test('mix: sin repetir y máx. 3 por artista', () => {
  const l = Array.from({ length: 6 }, (_, i) => ({ id: 'a' + i, artist: 'Mismo' })).concat([{ id: 'b', artist: 'Otro' }]);
  const out = mix([l]); assert.equal(out.filter(s => s.artist === 'Mismo').length, 3); assert.ok(out.some(s => s.id === 'b'));
});
test('GET /api/music/genre: pop trae canciones pop variadas', async () => {
  const l = await get('music/genre?g=pop');
  assert.ok(l.length >= 5, 'hay varias canciones'); assert.ok(l.every(s => s.tags.includes('genre:pop')));
  assert.ok(new Set(l.map(s => s.artist)).size >= 4, 'de varios artistas');
  assert.deepEqual(await get('music/genre?g=inventado'), []);
});
test('GET /api/music/artists y /similar', async () => {
  const mine = await get('music/artists?names=Coldplay');
  assert.deepEqual(mine.map(s => s.artist).sort(), ['Coldplay', 'Coldplay']); // descarta "Coldplay Tribute"
  const sim = await get('music/similar?names=Coldplay');
  assert.ok(sim.length >= 3); assert.ok(sim.every(s => s.via === 'coldplay')); assert.ok(sim.some(s => s.artist === 'Muse') && sim.some(s => s.artist === 'Keane'));
});
test('GET /api/games/genre y /feed', async () => {
  const g = await get('games/genre?g=terror');
  assert.equal(g[0].title, 'Phasmophobia'); assert.ok(g.every(x => x.tags.includes('gamegenre:terror') && x.tags.includes('platform:pc')));
  const f = await get('games/feed?p=pc');
  assert.ok(f.length >= 2 && f.every(n => n.type === 'news' && n.tags.includes('platform:pc')));
  assert.ok(f.find(n => /terror/.test(n.title)).tags.includes('gamegenre:terror'));
  const all = await get('games/feed?p=all'); assert.ok(all[0].tags.includes('gamegenre:terror') && all[0].tags.includes('platform:nintendo'));
});
test('GET /api/media/genre: terror trae series y películas de terror', async () => {
  const l = await get('media/genre?g=terror');
  assert.ok(l.some(i => i.type === 'series' && i.title === 'Wednesday') && l.some(i => i.type === 'movie' && i.title === 'La Monja'));
  assert.ok(l.every(i => i.tags.includes('mediagenre:terror')));
  assert.ok(!l.some(i => i.title === 'Sitcom Nuevo'));
});
test('caché: parámetros de más no crean entradas nuevas', async () => {
  const n = () => globalThis.fetch.length; // sin uso; se comprueba con las llamadas simuladas
  const { calls } = await import('./mock-fetch.mjs'); const before = calls.length;
  await get('music/genre?g=pop&x=1'); await get('music/genre?g=pop&x=2'); assert.equal(calls.length, before);
});
test('recomendador: terror + PC pone primero los juegos de terror en PC', () => {
  const p = prof({ 'gamegenre:terror': 5, 'platform:pc': 5 }), mk = (id, tags) => ({ id, type: 'game', tags, popularity: .5, publishedAt: now });
  const items = [mk('a', ['gamegenre:terror', 'platform:xbox']), mk('b', ['gamegenre:terror', 'platform:pc']), mk('c', ['gamegenre:rpg', 'platform:pc']), mk('d', ['gamegenre:deportes', 'platform:xbox'])];
  const f = rec.buildFeed(items, p, 4).map(i => i.id); assert.equal(f[0], 'b'); assert.equal(f.at(-1), 'd');
});
test('recomendador: interacciones cambian el orden y pop en música no trae solo pop', () => {
  const song = (id, g, a) => ({ id, type: 'song', artist: a, tags: [`genre:${g}`, `artist:${a}`], popularity: .5, publishedAt: now });
  const items = [song('1', 'pop', 'x'), song('2', 'rock', 'y'), song('3', 'pop', 'z')], p = prof({ 'genre:pop': 5 });
  assert.notEqual(rec.buildFeed(items, p, 3)[0].id, '2'); // con gusto por pop, el rock no va primero
  const w0 = rec.weight('genre:rock', p); p.tags['genre:rock'] = [{ w: 8, t: now }]; assert.ok(rec.weight('genre:rock', p) > w0);
  assert.equal(rec.buildFeed(items, p, 3)[0].id, '2'); // le dio ♥ a rock: ahora rock manda
});
test('recomendador: similares a una banda que le gusta suben, y why() lo explica', () => {
  const p = prof({ 'artist:coldplay': 8 }), a = { id: 'm', type: 'song', via: 'coldplay', tags: ['artist:muse', 'genre:alternative'], popularity: .5 }, b = { ...a, id: 'n', via: undefined };
  assert.ok(rec.score(a, p) > rec.score(b, p)); assert.equal(rec.why(a, p, t => 'Coldplay'), 'Parecido a Coldplay');
  assert.equal(rec.why({ tags: ['gamegenre:terror', 'platform:pc'] }, prof({ 'gamegenre:terror': 5, 'platform:pc': 5 }), t => t.split(':')[1]), 'Porque te gusta: terror en pc');
});
test.after(() => setTimeout(() => process.exit(0), 50));
