// Contenido para personalizar la portada según los gustos del usuario.
//
// Cada endpoint devuelve una "bolsa" de candidatos para UN gusto (un género, una plataforma, un grupo de bandas).
// El navegador junta las bolsas de los gustos que más pesan en el perfil y las ordena con el recomendador.
// Así las respuestas se pueden cachear para todos los usuarios: nada acá depende de quién pregunta.
import crypto from 'node:crypto';
import { MUSIC_GENRES, GAME_GENRES, MEDIA_GENRES, normName, artistTags, gameTagsFromText } from '../public/js/shared.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Cola que separa los pedidos con una pausa: iTunes limita a ~20 pedidos por minuto por IP.
export const makePacer = gap => { let chain = Promise.resolve(); return fn => { const run = chain.then(fn); chain = run.catch(() => {}).then(() => sleep(gap)); return run; }; };
const enc = encodeURIComponent;
const parseNames = (q, max) => [...new Set(String(q ?? '').split(',').map(s => s.trim()).filter(s => s && s.length <= 60))].slice(0, max);
const unique = list => [...new Map(list.map(i => [i.id, i])).values()];

// Junta varias listas de canciones intercalándolas, sin repetir y con un máximo por artista (para que haya variedad).
export function mix(lists, { perArtist = 3, max = 60 } = {}) {
  const seen = new Set(), count = new Map(), out = [];
  for (let i = 0; out.length < max && lists.some(l => i < l.length); i++)
    for (const l of lists) {
      const s = l[i]; if (!s || seen.has(s.id)) continue;
      const a = normName(s.artist); if ((count.get(a) || 0) >= perArtist) continue;
      seen.add(s.id); count.set(a, (count.get(a) || 0) + 1); out.push(s);
    }
  return out;
}

// ---------- RSS ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m);
const unCdata = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const plain = raw => decode(unCdata(raw).replace(/<[^>]+>/g, ' ')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const httpUrl = u => /^https?:\/\//i.test(u || '') ? u : '';
// Lector mínimo de RSS/Atom: lo suficiente para título, enlace, fecha, resumen e imagen.
export function parseRss(xml) {
  const out = [];
  for (const [block] of String(xml).matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)) {
    const tag = n => { const m = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i').exec(block); return m ? m[1] : ''; };
    const attr = (n, a) => { const m = new RegExp(`<${n}\\s[^>]*?${a}=["']([^"']+)["']`, 'i').exec(block); return m ? decode(m[1]) : ''; };
    const html = decode(unCdata(tag('content:encoded') || tag('description') || tag('summary') || tag('content')));
    const title = plain(tag('title')), link = httpUrl(plain(tag('link')) || attr('link', 'href')), date = Date.parse(plain(tag('pubDate') || tag('published') || tag('updated') || tag('dc:date')));
    const enclosure = /image/.test(attr('enclosure', 'type')) ? attr('enclosure', 'url') : '';
    const image = httpUrl(attr('media:thumbnail', 'url') || attr('media:content', 'url') || enclosure || /<img[^>]+src=["']([^"']+)["']/i.exec(html)?.[1] || '');
    if (title && link) out.push({ title, link, publishedAt: Number.isNaN(date) ? undefined : date, summary: plain(html).slice(0, 300), image });
  }
  return out;
}

// Medios de noticias de videojuegos por plataforma (RSS públicos). Si alguno cae, solo se pierden sus notas.
const FEEDS = {
  pc: [['PC Gamer', 'https://www.pcgamer.com/rss/'], ['Rock Paper Shotgun', 'https://www.rockpapershotgun.com/feed']],
  playstation: [['PlayStation Blog', 'https://blog.playstation.com/feed/'], ['Push Square', 'https://www.pushsquare.com/feeds/latest']],
  xbox: [['Xbox Wire', 'https://news.xbox.com/en-us/feed/'], ['Pure Xbox', 'https://www.purexbox.com/feeds/latest']],
  nintendo: [['Nintendo Life', 'https://www.nintendolife.com/feeds/latest']],
  móvil: [['Pocket Gamer', 'https://www.pocketgamer.com/rss/']],
  all: [['Eurogamer', 'https://www.eurogamer.net/feed'], ['GameSpot', 'https://www.gamespot.com/feeds/news/'], ['Vandal', 'https://vandal.elespanol.com/xml.cgi']]
};
const day = t => new Date(t).toISOString().slice(0, 10);

export function registerPersonal({ route, cached, j, chartSongs, song, movieFrom, show, gameFrom, hdr, enrich, H, D }) {
  const itunes = makePacer(300), steamspy = makePacer(1500);
  // Los pedidos a iTunes van en cola y se reintentan una vez (si el límite se pasó, suele bastar con esperar).
  const ij = u => itunes(() => j(u)).catch(async e => { await sleep(1500); return itunes(() => j(u)); });
  const text = async u => { const r = await fetch(u, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Pulso/1.0', Accept: 'application/rss+xml, application/atom+xml, text/xml, */*' } }); if (!r.ok) throw new Error('RSS ' + r.status); return r.text(); };

  // ---------- Música ----------
  const withTag = (songs, tag) => songs.map(s => s.tags.includes(tag) ? s : { ...s, tags: [...s.tags, tag] });
  const tracks = d => (d.results || []).filter(r => r.trackName && r.artistName && (!r.kind || r.kind === 'song'));
  async function genreSongs(key) {
    const g = MUSIC_GENRES[key]; if (!g) return [];
    const jobs = await Promise.allSettled([
      ij(`https://itunes.apple.com/ar/rss/topsongs/limit=50/genre=${g.chart}/json`).then(d => withTag(chartSongs(d), 'genre:' + key)),
      ...g.terms.map(t => ij(`https://itunes.apple.com/search?term=${enc(t)}&attribute=genreTerm&entity=song&limit=40&country=AR`).then(d => withTag(tracks(d).map(song), 'genre:' + key)))
    ]);
    const ok = jobs.filter(x => x.status === 'fulfilled');
    if (!ok.length) throw new Error('Sin respuesta de iTunes'); // no se cachea un fallo como si fuera "sin resultados"
    return mix(ok.map(x => x.value));
  }
  async function artistSongs(name, limit = 12) {
    const n = normName(name), d = await ij(`https://itunes.apple.com/search?term=${enc(name)}&entity=song&attribute=artistTerm&limit=${limit}&country=AR`);
    return tracks(d).filter(t => artistTags(t.artistName).includes('artist:' + n)) // el artista o un colaborador exacto; descarta "Coldplay Tribute"
      .map((t, i) => ({ ...song(t), popularity: Math.max(0.3, 0.9 - i * 0.04) }));
  }
  // Artistas parecidos según Deezer (público, sin clave). Solo se acepta un artista que coincida con el nombre buscado.
  async function relatedArtists(name) {
    const n = normName(name), s = await j(`https://api.deezer.com/search/artist?q=${enc(name)}&limit=3`);
    const hit = (s.data || []).find(a => normName(a.name) === n) || (s.data || []).find(a => normName(a.name).includes(n) || n.includes(normName(a.name)));
    if (!hit) return [];
    const r = await j(`https://api.deezer.com/artist/${hit.id}/related?limit=10`);
    return (r.data || []).map(a => a.name).filter(x => normName(x) !== n);
  }

  route('/api/music/genre', 6 * H, r => genreSongs(String(r.query.g || '')), ['g']);
  route('/api/music/artists', 12 * H, async r => {
    const res = await Promise.allSettled(parseNames(r.query.names, 4).map(n => artistSongs(n)));
    if (res.length && res.every(x => x.status === 'rejected')) throw new Error('Sin respuesta de iTunes');
    return unique(res.filter(x => x.status === 'fulfilled').flatMap(x => x.value));
  }, ['names']);
  route('/api/music/similar', 12 * H, async r => {
    const per = await Promise.all(parseNames(r.query.names, 4).map(async name => {
      const n = normName(name); let songs = [];
      for (const a of (await relatedArtists(name).catch(() => [])).slice(0, 3)) songs.push(...(await artistSongs(a, 6).catch(() => [])).slice(0, 4));
      if (!songs.length) { // sin Deezer: gente del mismo género
        const own = await artistSongs(name, 3).catch(() => []), g = own[0]?.tags.find(t => t.startsWith('genre:'))?.slice(6);
        if (g && MUSIC_GENRES[g]) songs = (await genreSongs(g)).filter(s => !s.tags.includes('artist:' + n)).slice(0, 8);
      }
      return songs.map(s => ({ ...s, via: n }));
    }));
    return unique(per.flat());
  }, ['names']);

  // ---------- Videojuegos ----------
  // Juegos populares de un género (SteamSpy: lista por etiqueta, ordenada por jugadores de las últimas dos semanas).
  async function gamesByGenre(key) {
    const g = GAME_GENRES[key]; if (!g) return [];
    try {
      const d = await steamspy(() => j(`https://steamspy.com/api.php?request=tag&tag=${enc(g.spy)}`));
      const list = Object.values(d || {}).filter(x => x?.appid && x.name).sort((a, b) => (b.average_2weeks || 0) - (a.average_2weeks || 0) || (b.positive || 0) - (a.positive || 0)).slice(0, 24);
      if (list.length) return list.map(x => ({ id: 'steam:' + x.appid, type: 'game', title: x.name,
        subtitle: [x.developer, +x.price > 0 ? 'US$ ' + (x.price / 100).toFixed(2) : 'Gratis'].filter(Boolean).join(' · '),
        image: hdr(x.appid), tags: ['gamegenre:' + key, 'platform:pc', ...gameTagsFromText(x.name)].filter((t, i, a) => a.indexOf(t) === i),
        popularity: 0.6 * Math.min(1, Math.log10(1 + (x.ccu || 0)) / 5) + 0.4 * Math.min(1, (x.positive || 0) / 300000), sourceUrl: 'https://store.steampowered.com/app/' + x.appid })); // jugadores de ayer + reseñas
    } catch {}
    // Respaldo: búsqueda de la tienda de Steam por el nombre del género.
    const d = await j(`https://store.steampowered.com/api/storesearch/?term=${enc(key)}&l=spanish&cc=AR`);
    return (await enrich((d.items || []).filter(i => i.type === 'app').slice(0, 12))).map(x => ({ ...x, tags: [...new Set([...x.tags, 'gamegenre:' + key])] }));
  }
  route('/api/games/genre', 6 * H, r => gamesByGenre(String(r.query.g || '')), ['g']);
  // Noticias de una plataforma (o generales con p=all), etiquetadas con plataforma y género detectados en el texto.
  route('/api/games/feed', 30 * 60, async r => {
    const p = FEEDS[r.query.p] ? String(r.query.p) : 'all';
    const per = await Promise.allSettled(FEEDS[p].map(async ([source, url]) => parseRss(await text(url)).slice(0, 12).map((x, i, a) => ({
      id: 'rss:' + crypto.createHash('sha1').update(x.link).digest('hex').slice(0, 14), type: 'news', title: x.title,
      subtitle: source, // la fecha (publishedAt) la formatea el navegador image: x.image, summary: x.summary,
      tags: [...new Set([...(p === 'all' ? [] : ['platform:' + p]), ...gameTagsFromText(x.title + ' ' + x.summary)])],
      popularity: 0.6 - 0.3 * i / a.length, publishedAt: x.publishedAt, sourceUrl: x.link }))));
    const ok = per.filter(x => x.status === 'fulfilled').flatMap(x => x.value);
    if (!ok.length && per.length) throw new Error('Sin noticias');
    return unique(ok).sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  }, ['p']);

  // ---------- Series y películas ----------
  const ar = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  // Series de la semana en plataformas + las de más peso históricas (TVmaze no filtra por género, así que se filtra acá).
  const showsPool = () => cached('showspool', 6 * H, async () => {
    const days = Array.from({ length: 7 }, (_, i) => ar.format(Date.now() + i * 864e5));
    const jobs = await Promise.allSettled([...days.map(d => j(`https://api.tvmaze.com/schedule/web?date=${d}`).then(eps => eps.map(e => e._embedded?.show || e.show))),
      j('https://api.tvmaze.com/shows?page=0'), j('https://api.tvmaze.com/shows?page=1')]);
    return [...new Map(jobs.filter(x => x.status === 'fulfilled').flatMap(x => x.value).filter(s => s?.id).map(s => [s.id, s])).values()];
  });
  route('/api/media/genre', 6 * H, async r => {
    const key = String(r.query.g || ''), g = MEDIA_GENRES[key]; if (!g) return [];
    const tag = 'mediagenre:' + key;
    const [pool, mv] = await Promise.all([showsPool().catch(() => []), Promise.allSettled(g.terms.map(t =>
      ij(`https://itunes.apple.com/search?term=${enc(t)}&media=movie&entity=movie&attribute=genreTerm&country=AR&limit=20`).then(d => (d.results || []).map(movieFrom))))]);
    const shows = pool.filter(s => (s.genres || []).some(x => g.tv.includes(x)) || g.tvType?.includes(s.type))
      .sort((a, b) => (b.weight || 0) - (a.weight || 0)).slice(0, 14).map(show);
    const movies = unique(mv.filter(x => x.status === 'fulfilled').flatMap(x => x.value)).slice(0, 14);
    const tagged = l => l.map(i => i.tags.includes(tag) ? i : { ...i, tags: [...i.tags, tag] });
    if (!shows.length && !movies.length && mv.every(x => x.status === 'rejected')) throw new Error('Sin respuesta');
    return unique(Array.from({ length: 14 }, (_, i) => [tagged(shows)[i], tagged(movies)[i]]).flat().filter(Boolean));
  }, ['g']);
}
