import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFredObservations, fetchFredSeries } from '../src/sources/fred.js';

const SAMPLE = {
  observations: [
    { date: '2026-01-01', value: '5.00' },
    { date: '2026-01-02', value: '.' },
    { date: '2026-01-03', value: '5.14' },
  ],
};

test('parseFredObservations ignore les "." et prend la dernière valeur', () => {
  const { value, history } = parseFredObservations(SAMPLE);
  assert.equal(value, 5.14);
  assert.deepEqual(history, [5.0, 5.14]);
});

test("parseFredObservations limite l'historique à 60 points", () => {
  const obs = Array.from({ length: 100 }, (_, i) => ({ date: `d${i}`, value: String(i) }));
  const { history, value } = parseFredObservations({ observations: obs });
  assert.equal(history.length, 60);
  assert.equal(history[0], 40);
  assert.equal(value, 99);
});

test("fetchFredSeries construit l'URL avec la clé et parse la réponse", async () => {
  let calledUrl = '';
  const fakeFetch = async (url) => {
    calledUrl = url;
    return { ok: true, json: async () => SAMPLE };
  };
  const res = await fetchFredSeries('DGS30', 'KEY123', fakeFetch);
  assert.match(calledUrl, /series_id=DGS30/);
  assert.match(calledUrl, /api_key=KEY123/);
  assert.equal(res.value, 5.14);
});

test("fetchFredSeries jette si la réponse n'est pas ok", async () => {
  const fakeFetch = async () => ({ ok: false, status: 429 });
  await assert.rejects(() => fetchFredSeries('DGS30', 'KEY', fakeFetch), /429/);
});
