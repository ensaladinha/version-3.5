import test from 'node:test';
import assert from 'node:assert/strict';
const { P, setProfile, learn, setBands, label, topKeys, session } = await import('../public/js/state.js');
const { weight } = await import('../public/js/recommender.js');

test('setProfile limpia datos corruptos y conserva la misma referencia', () => {
  const ref = P;
  setProfile({ tags: [1, 2], bands: ['Muse', 5, null], favorites: 'x', blocked: { a: 1 } });
  assert.equal(P, ref);
  assert.deepEqual(P.tags, {}); assert.deepEqual(P.bands, ['Muse']); assert.deepEqual(P.favorites, []); assert.deepEqual(P.blocked, []);
  setProfile(null); assert.equal(P.onboardingDone, false);
});
test('learn suma peso y compacta el historial largo sin perder el total', () => {
  setProfile(null);
  const it = { tags: ['genre:rock'] };
  for (let i = 0; i < 60; i++) learn(it, 1);
  assert.ok(P.tags['genre:rock'].length <= 41, 'historial acotado');
  assert.ok(Math.abs(weight('genre:rock', P) - 60) < 0.5, 'el puntaje total se conserva');
  learn(it, -4); assert.ok(weight('genre:rock', P) < 57);
});
test('setBands da peso fuerte al artista y lo quita al borrarlo', () => {
  setProfile(null); setBands(['Coldplay']);
  assert.ok(weight('artist:coldplay', P) >= 7.9); assert.deepEqual(topKeys('artist:', 3, 2), ['coldplay']);
  setBands([]); assert.ok(weight('artist:coldplay', P) <= 0.01);
});
test('label usa el nombre escrito por la persona y etiquetas en español', () => {
  setProfile(null); setBands(['Soda Stereo']);
  assert.equal(label('artist:soda stereo'), 'Soda Stereo');
  assert.equal(label('gamegenre:terror'), 'Terror'); assert.equal(label('platform:playstation'), 'PlayStation');
});
test('la sesión empieza vacía', () => assert.equal(session.user, null));
