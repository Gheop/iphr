import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEia, fetchEiaSeries } from '../src/sources/eia.js';

const SAMPLE = { response: { data: [
  { period: '2026-03', value: 2860 },
  { period: '2026-02', value: 2840 },
  { period: '2026-01', value: 2810 },
] } };

test('parseEia remet en ordre chronologique et prend la valeur récente', () => {
  const { value, history } = parseEia(SAMPLE);
  assert.equal(value, 2860);
  assert.deepEqual(history, [2810, 2840, 2860]);
});

test('parseEia gère une réponse vide', () => {
  assert.deepEqual(parseEia({ response: { data: [] } }), { value: null, history: [] });
});

test("fetchEiaSeries construit l'URL avec seriesId + clé", async () => {
  let url = '';
  const fakeFetch = async (u) => { url = u; return { ok: true, json: async () => SAMPLE }; };
  const res = await fetchEiaSeries('steo', 'PASC_OECD_T3', 'KEY123', fakeFetch);
  assert.match(url, /v2\/steo\/data/);
  assert.match(url, /PASC_OECD_T3/);
  assert.match(url, /api_key=KEY123/);
  assert.equal(res.value, 2860);
});

test('fetchEiaSeries jette sur HTTP non-ok', async () => {
  await assert.rejects(() => fetchEiaSeries('steo', 'X', 'K', async () => ({ ok: false, status: 403 })), /403/);
});

test("parseEia trie par période même si l'ordre API est mélangé", () => {
  const shuffled = { response: { data: [
    { period: '2026-01', value: 2810 },
    { period: '2026-03', value: 2860 },
    { period: '2026-02', value: 2840 },
  ] } };
  const { value, history } = parseEia(shuffled);
  assert.equal(value, 2860);
  assert.deepEqual(history, [2810, 2840, 2860]);
});

test("fetchEiaSeries accepte un facet et une fréquence personnalisés (route petroleum)", async () => {
  let url = '';
  const fakeFetch = async (u) => { url = u; return { ok: true, json: async () => SAMPLE }; };
  await fetchEiaSeries('petroleum/stoc/wstk', 'WCSSTUS1', 'K', fakeFetch, { facetKey: 'series', frequency: 'weekly' });
  assert.match(url, /v2\/petroleum\/stoc\/wstk\/data/);
  assert.match(url, /facets\[series\]\[\]=WCSSTUS1/);
  assert.match(url, /frequency=weekly/);
});
