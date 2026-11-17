// Respuestas simuladas de iTunes, Deezer, SteamSpy, TVmaze y RSS para probar sin red.
const real = globalThis.fetch;
export const calls = [];
const json = o => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
const trk = (id, name, artist, genre) => ({ wrapperType: 'track', kind: 'song', trackId: id, trackName: name, artistName: artist, primaryGenreName: genre, artworkUrl100: 'https://img/100x100.jpg', previewUrl: 'https://prev/' + id + '.m4a' });
const entry = (id, name, artist, cat, rd = '2026-10-20T00:00:00-07:00') => ({ id: { attributes: { 'im:id': String(id) } }, 'im:name': { label: name }, 'im:artist': { label: artist },
  'im:image': [{ label: 'https://img/55x55.jpg' }, { label: 'https://img/170x170.jpg' }], category: { attributes: { term: cat } }, 'im:releaseDate': { label: rd }, link: [{ attributes: { href: 'https://x' } }, { attributes: { href: 'https://prev/' + id + '.m4a' } }] });
const rss = (title, items) => `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>${title}</title>${items.map(([t, l, d]) => `<item><title><![CDATA[${t}]]></title><link>${l}</link><pubDate>${new Date(d).toUTCString()}</pubDate><description><![CDATA[<p>${t} &amp; más</p>]]></description><media:thumbnail url="https://img/${encodeURIComponent(t)}.jpg"/></item>`).join('')}</channel></rss>`;

function external(u) {
  const x = new URL(u), q = x.searchParams;
  if (x.host === 'itunes.apple.com') {
    if (x.pathname.includes('/rss/topsongs')) { const g = /genre=(\d+)/.exec(x.pathname)?.[1];
      const names = { 14: ['Pop', [['Flowers', 'Miley Cyrus'], ['Anti-Hero', 'Taylor Swift'], ['Die For You', 'The Weeknd']]], 21: ['Rock', [['Mr. Brightside', 'The Killers'], ['Believer', 'Imagine Dragons']]] }[g];
      const [cat, list] = names || ['Música', [['Tema', 'Alguien']]];
      return json({ feed: { entry: list.map(([n, a], i) => entry(100 + i + +g, n, a, cat)) } }); }
    if (x.pathname.includes('/rss/topmovies')) return json({ feed: { entry: [] } });
    if (x.pathname === '/search') {
      const term = q.get('term'), attr = q.get('attribute');
      if (q.get('media') === 'movie') return json({ results: [{ trackId: 7001, trackName: 'La Monja', releaseDate: '2018-09-05T07:00:00Z', primaryGenreName: 'Terror', artworkUrl100: 'https://img/100x100bb.jpg', trailerUrl: 'x', previewUrl: 'https://p/m.m4v', trackViewUrl: 'https://tv/7001' }] });
      if (attr === 'genreTerm') return json({ results: term === 'Pop' ? [trk(1, 'Levitating', 'Dua Lipa', 'Pop'), trk(2, 'Blinding Lights', 'The Weeknd', 'Pop'), trk(3, 'Flowers', 'Miley Cyrus', 'Pop')] : term === 'Rock' ? [trk(11, 'Yellow', 'Coldplay', 'Rock'), trk(12, 'Zoom', 'Soda Stereo', 'Rock en español')] : [trk(30, 'Algo', 'Otro', term)] });
      if (attr === 'artistTerm') { const t = term.toLowerCase();
        if (t.includes('coldplay')) return json({ results: [trk(21, 'Yellow', 'Coldplay', 'Alternative'), trk(22, 'Clocks', 'Coldplay', 'Alternative'), trk(23, 'Cover', 'Coldplay Tribute', 'Pop')] });
        if (t.includes('muse')) return json({ results: [trk(31, 'Uprising', 'Muse', 'Alternative'), trk(32, 'Starlight', 'Muse', 'Alternative')] });
        if (t.includes('keane')) return json({ results: [trk(41, 'Somewhere Only We Know', 'Keane', 'Alternative')] });
        return json({ results: [] }); } }
  }
  if (x.host === 'api.deezer.com') {
    if (x.pathname === '/search/artist') return json({ data: /coldplay/i.test(q.get('q')) ? [{ id: 892, name: 'Coldplay' }] : [] });
    if (x.pathname === '/artist/892/related') return json({ data: [{ name: 'Muse' }, { name: 'Keane' }, { name: 'Travis' }] });
  }
  if (x.host === 'steamspy.com') {
    const tag = q.get('tag'), mk = (id, name, a2) => [id, { appid: id, name, developer: 'Dev', price: '1999', positive: 90000, negative: 5000, average_2weeks: a2 }];
    return json(Object.fromEntries(tag === 'Horror' ? [mk(381210, 'Dead by Daylight', 900), mk(739630, 'Phasmophobia', 1200), mk(1, 'Viejo juego de terror', 5)] : [mk(570, 'Dota 2', 5000)]));
  }
  if (x.host === 'store.steampowered.com' || x.host === 'api.steampowered.com') return json({});
  if (x.host === 'api.tvmaze.com') {
    if (x.pathname === '/schedule/web') return json([{ number: 1, _embedded: { show: { id: 900, name: 'Wednesday', genres: ['Comedy', 'Horror'], type: 'Scripted', weight: 99, premiered: '2026-10-30', language: 'English', image: { medium: 'https://img/w.jpg' }, webChannel: { name: 'Netflix' } } } },
      { number: 2, _embedded: { show: { id: 901, name: 'Sitcom Nuevo', genres: ['Comedy'], type: 'Scripted', weight: 80, premiered: '2026-10-01', language: 'English' } } }]);
    if (x.pathname === '/shows') return json([{ id: 1, name: 'Breaking Bad', genres: ['Drama', 'Crime'], type: 'Scripted', weight: 100, premiered: '2008-01-20' }]);
    if (x.pathname === '/schedule') return json([]);
  }
  const feed = { 'www.pcgamer.com': ['PC Gamer', [['Nuevo juego de terror llega a PC con modo cooperativo', 'https://pcgamer.com/a', Date.now() - 36e5], ['Guía de RPG para principiantes', 'https://pcgamer.com/b', Date.now() - 72e5]]],
    'news.xbox.com': ['Xbox Wire', [['Xbox anuncia nuevos juegos de Game Pass para noviembre', 'https://news.xbox.com/a', Date.now() - 5e5]]],
    'www.eurogamer.net': ['Eurogamer', [['Resident Evil: survival horror vuelve en Nintendo Switch 2', 'https://eurogamer.net/a', Date.now() - 9e5]]] }[x.host];
  if (feed) return new Response(rss(...feed), { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  return null;
}
globalThis.fetch = async (u, o) => {
  const url = String(u?.url ?? u);
  if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url)) return real(u, o);
  calls.push(url);
  return external(url) ?? new Response('nope', { status: 404 });
};
