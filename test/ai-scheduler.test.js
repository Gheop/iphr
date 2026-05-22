import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shouldRefresh, runAi, nextDailyRunMs } from '../src/ai-scheduler.js';

function parisHM(ms) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour12: false, hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms));
  const o = {};
  for (const x of p) o[x.type] = x.value;
  return `${o.hour}:${o.minute}`;
}

test('shouldRefresh : vrai si cache absent', () => {
  assert.equal(shouldRefresh(null, 24, Date.now()), true);
  assert.equal(shouldRefresh({}, 24, Date.now()), true);
});

test('shouldRefresh : faux si cache récent, vrai si trop vieux', () => {
  const now = Date.parse('2026-05-22T12:00:00Z');
  assert.equal(shouldRefresh({ generatedAt: '2026-05-22T06:00:00Z' }, 24, now), false);
  assert.equal(shouldRefresh({ generatedAt: '2026-05-21T06:00:00Z' }, 24, now), true);
});

const ANALYSIS = {
  scenario: { spiral: { probability: '≈ 28 %', bullets: ['a'] }, noSpiral: { probability: '≈ 72 %', bullets: ['b'] }, thresholds: ['t'] },
  editorialBadges: {},
};

test('runAi analyse et met en cache si stale + clé présente', async () => {
  const cachePath = join(mkdtempSync(join(tmpdir(), 'iphr-ai-')), 'ai.json');
  let calls = 0;
  const out = await runAi(() => ({ sections: [] }), {
    cachePath, hours: 24, now: Date.now(), apiKey: 'K',
    analyzeImpl: async () => { calls++; return ANALYSIS; }, log: { warn() {} },
  });
  assert.equal(calls, 1);
  assert.equal(out.scenario.spiral.probability, '≈ 28 %');
  assert.ok(out.generatedAt);
});

test('runAi ne rappelle pas si le cache est récent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'iphr-ai-'));
  const cachePath = join(dir, 'ai.json');
  const now = Date.parse('2026-05-22T12:00:00Z');
  let calls = 0;
  const deps = { cachePath, hours: 24, now, apiKey: 'K', analyzeImpl: async () => { calls++; return ANALYSIS; }, log: { warn() {} } };
  await runAi(() => ({ sections: [] }), deps);
  const out = await runAi(() => ({ sections: [] }), { ...deps, now: now + 3600 * 1000 });
  assert.equal(calls, 1);
  assert.ok(out.scenario);
});

test('runAi ne fait rien sans clé', async () => {
  const cachePath = join(mkdtempSync(join(tmpdir(), 'iphr-ai-')), 'ai.json');
  let calls = 0;
  const out = await runAi(() => ({ sections: [] }), {
    cachePath, hours: 24, now: Date.now(), apiKey: '',
    analyzeImpl: async () => { calls++; return ANALYSIS; }, log: { warn() {} },
  });
  assert.equal(calls, 0);
  assert.equal(out, null);
});

test('nextDailyRunMs renvoie le prochain 05:30 Europe/Paris dans le futur (< 24 h)', () => {
  const now = Date.parse('2026-05-22T15:56:00Z'); // ~17:56 Paris (après 05:30)
  const t = nextDailyRunMs(5, 30, now);
  assert.ok(t > now);
  assert.ok(t - now <= 24 * 3600 * 1000 + 1000);
  assert.equal(parisHM(t), '05:30');
});

test('nextDailyRunMs : avant 05:30 Paris, c’est le jour même (dans quelques heures)', () => {
  const now = Date.parse('2026-05-22T01:00:00Z'); // 03:00 Paris (CEST)
  const t = nextDailyRunMs(5, 30, now);
  assert.ok(t > now && t - now < 4 * 3600 * 1000);
  assert.equal(parisHM(t), '05:30');
});

test('nextDailyRunMs reste 05:30 Paris même en hiver (DST off)', () => {
  const now = Date.parse('2026-01-15T12:00:00Z'); // hiver, CET (UTC+1)
  const t = nextDailyRunMs(5, 30, now);
  assert.equal(parisHM(t), '05:30');
});

test('runAi avec force régénère même si le cache est récent', async () => {
  const cachePath = join(mkdtempSync(join(tmpdir(), 'iphr-ai-')), 'ai.json');
  const now = Date.parse('2026-05-22T12:00:00Z');
  let calls = 0;
  const deps = { cachePath, hours: 24, apiKey: 'K', analyzeImpl: async () => { calls++; return ANALYSIS; }, log: { warn() {} } };
  await runAi(() => ({ sections: [] }), { ...deps, now });
  await runAi(() => ({ sections: [] }), { ...deps, now: now + 3600 * 1000, force: true });
  assert.equal(calls, 2);
});
