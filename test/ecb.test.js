import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEcbSdmx, fetchEcbSeries } from '../src/sources/ecb.js';

const SAMPLE = {
  dataSets: [{ series: { '0:0:0:0:0:0:0': { observations: { '0': [3.6], '1': [4.0], '2': [1.87] } } } }],
  structure: { dimensions: { observation: [{ values: [{ id: '2025-Q1' }, { id: '2025-Q2' }, { id: '2025-Q3' }] }] } },
};

test("parseEcbSdmx prend la dernière observation et garde l'historique", () => {
  const { value, history } = parseEcbSdmx(SAMPLE);
  assert.equal(value, 1.87);
  assert.deepEqual(history, [3.6, 4.0, 1.87]);
});

test('parseEcbSdmx renvoie value null si pas de série', () => {
  assert.deepEqual(parseEcbSdmx({ dataSets: [{ series: {} }] }), { value: null, history: [] });
});

test("fetchEcbSeries construit l'URL flow/key et parse", async () => {
  let url = '';
  const fakeFetch = async (u) => { url = u; return { ok: true, json: async () => SAMPLE }; };
  const res = await fetchEcbSeries('STS', 'Q.I9.N.INWR.000000.3.ANR', fakeFetch);
  assert.match(url, /service\/data\/STS\/Q\.I9\.N\.INWR\.000000\.3\.ANR/);
  assert.equal(res.value, 1.87);
});

test('fetchEcbSeries jette sur HTTP non-ok', async () => {
  await assert.rejects(() => fetchEcbSeries('STS', 'X', async () => ({ ok: false, status: 404 })), /404/);
});
