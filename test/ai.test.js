import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseAnalysis, nextFomcLabel } from '../src/ai.js';

const MODEL = {
  meta: { title: 'Régime IPHR' },
  sections: [{ id: '01', title: 'PÉTROLE', cards: [
    { id: 'brent', label: 'Brent Crude', displayValue: '$109.3', context: '+81 %', hidden: false },
    { id: 'rbob', label: '_rbob', displayValue: '2.6', context: '', hidden: true },
  ] }],
  scenario: { spiral: {}, noSpiral: {}, thresholds: [] },
};

test('buildPrompt met les valeurs des cartes visibles dans le message user', () => {
  const { system, user } = buildPrompt(MODEL);
  assert.match(user, /Brent Crude/);
  assert.match(user, /\$109\.3/);
  assert.doesNotMatch(user, /_rbob/);
});

test('buildPrompt interdit dans le system de produire des valeurs chiffrées', () => {
  const { system } = buildPrompt(MODEL);
  assert.match(system, /JSON/);
  assert.match(system, /aucune valeur chiffrée|ne calcule|n'invente/i);
});

const VALID = JSON.stringify({
  scenario: {
    spiral: { probability: '≈ 28 %', bullets: ['a', 'b'] },
    noSpiral: { probability: '≈ 72 %', bullets: ['c'] },
    thresholds: ['t1', 't2'],
  },
  editorialBadges: { backwardation: { text: 'EN BAISSE', tone: 'warn' } },
});

test('parseAnalysis accepte un JSON valide', () => {
  const a = parseAnalysis(VALID);
  assert.equal(a.scenario.spiral.probability, '≈ 28 %');
  assert.deepEqual(a.editorialBadges.backwardation, { text: 'EN BAISSE', tone: 'warn' });
});

test("parseAnalysis extrait le JSON même entouré de texte", () => {
  const a = parseAnalysis('Voici l\'analyse :\n' + VALID + '\nVoilà.');
  assert.equal(a.scenario.noSpiral.probability, '≈ 72 %');
});

test("parseAnalysis rejette un badge au tone invalide mais garde l'analyse", () => {
  const bad = JSON.parse(VALID);
  bad.editorialBadges.backwardation.tone = 'rouge';
  const a = parseAnalysis(JSON.stringify(bad));
  assert.equal(a.editorialBadges.backwardation, undefined);
  assert.ok(a.scenario);
});

test('parseAnalysis renvoie null si le scénario est incomplet', () => {
  assert.equal(parseAnalysis('{"scenario":{"spiral":{}},"editorialBadges":{}}'), null);
  assert.equal(parseAnalysis('pas de json'), null);
});

test('parseAnalysis ignore un badge sur une carte non éditoriale (ex. carte live)', () => {
  const obj = {
    scenario: {
      spiral: { probability: '≈ 30 %', bullets: ['x'] },
      noSpiral: { probability: '≈ 70 %', bullets: ['y'] },
      thresholds: ['t'],
    },
    editorialBadges: {
      brent: { text: 'PIÉGÉ', tone: 'alert' },   // carte live → doit être ignorée
      backwardation: { text: 'TENSION', tone: 'warn' },     // carte config → conservée
    },
  };
  const a = parseAnalysis(JSON.stringify(obj));
  assert.equal(a.editorialBadges.brent, undefined);
  assert.deepEqual(a.editorialBadges.backwardation, { text: 'TENSION', tone: 'warn' });
});

import { analyze } from '../src/ai.js';

const RESP = (text) => ({ ok: true, json: async () => ({ content: [{ type: 'text', text }] }) });

test("analyze appelle l'API avec la clé et renvoie l'analyse parsée", async () => {
  let captured = {};
  const fakeFetch = async (url, opts) => {
    captured = { url, headers: opts.headers, body: JSON.parse(opts.body) };
    return RESP(VALID);
  };
  const a = await analyze(MODEL, { apiKey: 'KEY', aiModel: 'claude-sonnet-4-6', fetchImpl: fakeFetch, log: { warn() {} } });
  assert.match(captured.url, /api\.anthropic\.com\/v1\/messages/);
  assert.equal(captured.headers['x-api-key'], 'KEY');
  assert.equal(captured.headers['anthropic-version'], '2023-06-01');
  assert.equal(captured.body.model, 'claude-sonnet-4-6');
  assert.equal(a.scenario.spiral.probability, '≈ 28 %');
});

test('analyze renvoie null sans clé (aucun appel)', async () => {
  let called = false;
  const a = await analyze(MODEL, { apiKey: '', fetchImpl: async () => { called = true; return RESP(VALID); }, log: { warn() {} } });
  assert.equal(a, null);
  assert.equal(called, false);
});

test('analyze renvoie null sur HTTP non-ok', async () => {
  const a = await analyze(MODEL, { apiKey: 'K', fetchImpl: async () => ({ ok: false, status: 429, text: async () => 'rate' }), log: { warn() {} } });
  assert.equal(a, null);
});

test('parseAnalysis garde le label fourni et complète le label manquant', () => {
  const withLabel = JSON.parse(VALID);
  withLabel.scenario.spiral.label = 'Régime de surchauffe';
  const a1 = parseAnalysis(JSON.stringify(withLabel));
  assert.equal(a1.scenario.spiral.label, 'Régime de surchauffe');
  assert.equal(a1.scenario.noSpiral.label, 'Pas de spirale');
});

test('nextFomcLabel renvoie la prochaine date future formatée FR', () => {
  const now = Date.parse('2026-05-22T12:00:00Z');
  const dates = ['2026-04-29', '2026-06-17', '2026-07-29'];
  assert.equal(nextFomcLabel(dates, now), '17 juin 2026');
});

test('nextFomcLabel renvoie null si liste vide ou toutes passées', () => {
  assert.equal(nextFomcLabel([], Date.now()), null);
  assert.equal(nextFomcLabel(['2020-01-01'], Date.parse('2026-05-22T00:00:00Z')), null);
});

test('buildPrompt inclut la prochaine FOMC quand fournie, sinon non', () => {
  assert.match(buildPrompt(MODEL, { nextFomc: '17 juin 2026' }).user, /FOMC.*17 juin 2026/);
  assert.doesNotMatch(buildPrompt(MODEL).user, /FOMC/);
});
