import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refresh } from '../src/scheduler.js';

const config = { sections: [{ id: '1', title: 't', cards: [
  { id: 'ust30', source: { type: 'fred', series: 'DGS30' } },
  { id: 'brent', source: { type: 'yahoo', symbol: 'BZ=F' } },
  { id: 'ism', source: { type: 'config' } },
] }] };

test("refresh remplit fetched depuis fred/yahoo et ignore config", async () => {
  const cachePath = join(mkdtempSync(join(tmpdir(), 'iphr-')), 'cache.json');
  const fetched = await refresh(config, {
    fredKey: 'K',
    fetchFred: async () => ({ value: 5.14, history: [5.14] }),
    fetchYahoo: async () => ({ value: 109.3, history: [109.3] }),
    cachePath,
    log: { warn() {} },
  });
  assert.equal(fetched.ust30.value, 5.14);
  assert.equal(fetched.brent.value, 109.3);
  assert.equal(fetched.ism, undefined);
});

test("refresh conserve le cache précédent quand une source échoue", async () => {
  const cachePath = join(mkdtempSync(join(tmpdir(), 'iphr-')), 'cache.json');
  await refresh(config, { fredKey: 'K', fetchFred: async () => ({ value: 5.0, history: [5.0] }),
    fetchYahoo: async () => ({ value: 100, history: [100] }), cachePath, log: { warn() {} } });
  const fetched = await refresh(config, { fredKey: 'K',
    fetchFred: async () => { throw new Error('boom'); },
    fetchYahoo: async () => ({ value: 110, history: [110] }), cachePath, log: { warn() {} } });
  assert.equal(fetched.ust30.value, 5.0); // valeur du cache conservée
  assert.equal(fetched.brent.value, 110);
});
