import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCache, writeCache } from '../src/cache.js';

test('readCache renvoie {} si le fichier est absent', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'iphr-')), 'cache.json');
  assert.deepEqual(readCache(p), {});
});

test('writeCache puis readCache fait un round-trip', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'iphr-')), 'cache.json');
  writeCache(p, { brent: { value: 109.3, history: [1, 2, 3] } });
  assert.deepEqual(readCache(p), { brent: { value: 109.3, history: [1, 2, 3] } });
});

test('readCache renvoie {} si le JSON est corrompu', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'iphr-')), 'cache.json');
  writeFileSync(p, '{ pas du json');
  assert.deepEqual(readCache(p), {});
});

test('writeCache crée le dossier parent si absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'iphr-'));
  const p = join(dir, 'nested', 'cache.json');
  writeCache(p, { ok: true });
  assert.equal(JSON.parse(readFileSync(p, 'utf8')).ok, true);
  rmSync(dir, { recursive: true, force: true });
});
