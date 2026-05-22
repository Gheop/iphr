import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYahooChart, fetchYahooSymbol } from '../src/sources/yahoo.js';

const SAMPLE = {
  chart: {
    result: [
      {
        meta: { regularMarketPrice: 109.3 },
        indicators: { quote: [{ close: [100, null, 105, 109.3] }] },
      },
    ],
  },
};

test('parseYahooChart prend regularMarketPrice et filtre les nuls', () => {
  const { value, history } = parseYahooChart(SAMPLE);
  assert.equal(value, 109.3);
  assert.deepEqual(history, [100, 105, 109.3]);
});

test('parseYahooChart retombe sur le dernier close si pas de regularMarketPrice', () => {
  const j = { chart: { result: [{ meta: {}, indicators: { quote: [{ close: [1, 2, 3] }] } }] } };
  assert.equal(parseYahooChart(j).value, 3);
});

test("fetchYahooSymbol construit l'URL et parse", async () => {
  let calledUrl = '';
  const fakeFetch = async (url) => {
    calledUrl = url;
    return { ok: true, json: async () => SAMPLE };
  };
  const res = await fetchYahooSymbol('BZ=F', fakeFetch);
  assert.match(calledUrl, /chart\/BZ%3DF/);
  assert.equal(res.value, 109.3);
});

test('fetchYahooSymbol jette si HTTP non ok', async () => {
  const fakeFetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(() => fetchYahooSymbol('BZ=F', fakeFetch), /404/);
});
