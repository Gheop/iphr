import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crackSpread321, thousandsToMb, evaluateBadge, buildModel } from '../src/compute.js';

test('crackSpread321 calcule le spread par baril', () => {
  // cl=80 $/bbl, rb=2.40 $/gal, ho=2.50 $/gal
  // (2*2.40*42 + 2.50*42 - 3*80)/3 = (201.6 + 105 - 240)/3 = 22.2
  assert.equal(Math.round(crackSpread321(80, 2.4, 2.5) * 10) / 10, 22.2);
});

test('thousandsToMb divise par 1000', () => {
  assert.equal(thousandsToMb(453000), 453);
});

test('evaluateBadge renvoie la première règle satisfaite', () => {
  const rules = [{ op: '>=', value: 90, text: 'CHOC', tone: 'alert' }];
  assert.deepEqual(evaluateBadge(109.3, rules, null), { text: 'CHOC', tone: 'alert' });
});

test('evaluateBadge retombe sur le badge statique si aucune règle ne matche', () => {
  const rules = [{ op: '>=', value: 200, text: 'CHOC', tone: 'alert' }];
  assert.deepEqual(evaluateBadge(50, rules, { text: 'OK', tone: 'ok' }), { text: 'OK', tone: 'ok' });
});

test('buildModel utilise la valeur live quand dispo', () => {
  const config = {
    meta: { title: 'T' },
    sections: [
      {
        id: '02', title: 'TAUX',
        cards: [
          { id: 'ust30', label: 'UST 30', decimals: 2, suffix: '%',
            source: { type: 'fred', series: 'DGS30' },
            rules: [{ op: '>=', value: 5, text: '≥ 5%', tone: 'warn' }],
            fallback: { value: 4.9, history: [4.9] } },
        ],
      },
    ],
    scenario: { spiral: {}, noSpiral: {}, thresholds: [] },
  };
  const fetched = { ust30: { value: 5.14, history: [5.0, 5.14] } };
  const m = buildModel(config, fetched);
  const card = m.sections[0].cards[0];
  assert.equal(card.value, 5.14);
  assert.equal(card.displayValue, '5.14%');
  assert.equal(card.stale, false);
  assert.deepEqual(card.badge, { text: '≥ 5%', tone: 'warn' });
});

test('buildModel retombe sur le fallback et marque stale quand pas de live', () => {
  const config = {
    meta: {},
    sections: [
      { id: '03', title: 'X', cards: [
        { id: 'ism', label: 'ISM', decimals: 1, source: { type: 'config' },
          fallback: { value: 84.6, history: [80, 84.6] }, badge: { text: 'HOT', tone: 'alert' } },
      ] },
    ],
    scenario: { spiral: {}, noSpiral: {}, thresholds: [] },
  };
  const m = buildModel(config, {});
  const card = m.sections[0].cards[0];
  assert.equal(card.value, 84.6);
  assert.equal(card.stale, true);
  assert.deepEqual(card.badge, { text: 'HOT', tone: 'alert' });
});

test('buildModel calcule le crack spread depuis les inputs fetchés', () => {
  const config = {
    meta: {},
    sections: [
      { id: '01', title: 'OIL', cards: [
        { id: 'crack', label: 'Crack', decimals: 1, prefix: '$',
          compute: 'crackSpread321', inputs: { cl: 'wti', rb: 'rbob', ho: 'ho' },
          fallback: { value: 0, history: [] } },
      ] },
    ],
    scenario: { spiral: {}, noSpiral: {}, thresholds: [] },
  };
  const fetched = {
    wti: { value: 80, history: [80] },
    rbob: { value: 2.4, history: [2.4] },
    ho: { value: 2.5, history: [2.5] },
  };
  const card = buildModel(config, fetched).sections[0].cards[0];
  assert.equal(card.displayValue, '$22.2');
  assert.equal(card.stale, false);
});

test("buildModel applique bpsFromPct (pct → bps)", () => {
  const config = {
    meta: {}, scenario: { spiral: {}, noSpiral: {}, thresholds: [] },
    sections: [{ id: '02', title: 'X', cards: [
      { id: 'hyoas', label: 'HY', decimals: 0, suffix: ' bps', transform: 'bpsFromPct',
        source: { type: 'fred', series: 'X' }, fallback: { value: 0, history: [] } },
    ] }],
  };
  const card = buildModel(config, { hyoas: { value: 2.8, history: [3.1, 2.8] } }).sections[0].cards[0];
  assert.equal(card.value, 280);
  assert.equal(card.displayValue, '280 bps');
});

test('buildModel retombe sur le fallback du crack si un input manque', () => {
  const config = {
    meta: {}, scenario: { spiral: {}, noSpiral: {}, thresholds: [] },
    sections: [{ id: '01', title: 'OIL', cards: [
      { id: 'crack', label: 'Crack', decimals: 1, prefix: '$',
        compute: 'crackSpread321', inputs: { cl: 'wti', rb: 'rbob', ho: 'ho' },
        fallback: { value: 54.7, history: [54.7] } },
    ] }],
  };
  const card = buildModel(config, { wti: { value: 80, history: [80] } }).sections[0].cards[0];
  assert.equal(card.value, 54.7);
  assert.equal(card.stale, true);
});

test("buildModel calcule l'historique du crack spread depuis les inputs", () => {
  const config = {
    meta: {}, scenario: { spiral: {}, noSpiral: {}, thresholds: [] },
    sections: [{ id: '01', title: 'OIL', cards: [
      { id: 'crack', label: 'Crack', decimals: 1, prefix: '$',
        compute: 'crackSpread321', inputs: { cl: 'wti', rb: 'rbob', ho: 'ho' },
        fallback: { value: 0, history: [] } },
    ] }],
  };
  const fetched = {
    wti: { value: 80, history: [80, 80] },
    rbob: { value: 2.4, history: [2.4, 2.4] },
    ho: { value: 2.5, history: [2.5, 2.5] },
  };
  const card = buildModel(config, fetched).sections[0].cards[0];
  assert.equal(card.history.length, 2);
  assert.equal(Math.round(card.history[0] * 10) / 10, 22.2);
});

test('buildModel renvoie "—" et value null si fallback absent', () => {
  const config = {
    meta: {}, scenario: { spiral: {}, noSpiral: {}, thresholds: [] },
    sections: [{ id: 'x', title: 'X', cards: [
      { id: 'orphan', label: 'Orphan', decimals: 0, source: { type: 'config' } },
    ] }],
  };
  const card = buildModel(config, {}).sections[0].cards[0];
  assert.equal(card.value, null);
  assert.equal(card.displayValue, '—');
  assert.equal(card.stale, true);
});

test('buildModel propage le flag hidden', () => {
  const config = { meta: {}, scenario: { spiral: {}, noSpiral: {}, thresholds: [] },
    sections: [{ id: '01', title: 'OIL', cards: [
      { id: 'rbob', label: '_rbob', hidden: true, source: { type: 'yahoo', symbol: 'RB=F' },
        fallback: { value: 2.6, history: [2.6] } },
      { id: 'brent', label: 'Brent', decimals: 1, source: { type: 'yahoo', symbol: 'BZ=F' },
        fallback: { value: 100, history: [100] } },
    ] }] };
  const cards = buildModel(config, {}).sections[0].cards;
  assert.equal(cards[0].hidden, true);
  assert.equal(cards[1].hidden, false);
});

test("buildModel remplace le scénario par celui de l'analyse IA", () => {
  const config = {
    meta: {}, scenario: { spiral: { probability: 'X', bullets: ['c'] }, noSpiral: {}, thresholds: ['old'] },
    sections: [],
  };
  const ai = {
    scenario: { spiral: { probability: '≈ 28 %', bullets: ['a'] }, noSpiral: { probability: '≈ 72 %', bullets: ['b'] }, thresholds: ['t-ai'] },
    editorialBadges: {},
  };
  const m = buildModel(config, {}, ai);
  assert.equal(m.scenario.spiral.probability, '≈ 28 %');
  assert.deepEqual(m.scenario.thresholds, ['t-ai']);
});

test("buildModel écrase le badge d'une carte config avec le badge éditorial IA", () => {
  const config = {
    meta: {}, scenario: { spiral: {}, noSpiral: {}, thresholds: [] },
    sections: [{ id: '04', title: 'X', cards: [
      { id: 'oecd', label: 'OECD', decimals: 0, source: { type: 'config' },
        fallback: { value: 4075, history: [4075] }, badge: { text: 'EN BAISSE', tone: 'warn' } },
    ] }],
  };
  const ai = { scenario: { spiral: {}, noSpiral: {}, thresholds: [] },
    editorialBadges: { oecd: { text: 'STOCK CRITIQUE', tone: 'alert' } } };
  const card = buildModel(config, {}, ai).sections[0].cards[0];
  assert.deepEqual(card.badge, { text: 'STOCK CRITIQUE', tone: 'alert' });
});

test('buildModel sans analyse IA garde le comportement config (rétrocompatible)', () => {
  const config = {
    meta: {}, scenario: { spiral: { probability: 'P', bullets: [] }, noSpiral: {}, thresholds: [] },
    sections: [{ id: '04', title: 'X', cards: [
      { id: 'oecd', label: 'OECD', decimals: 0, source: { type: 'config' },
        fallback: { value: 4075, history: [4075] }, badge: { text: 'EN BAISSE', tone: 'warn' } },
    ] }],
  };
  const card = buildModel(config, {}).sections[0].cards[0];
  assert.deepEqual(card.badge, { text: 'EN BAISSE', tone: 'warn' });
  assert.equal(buildModel(config, {}).scenario.spiral.probability, 'P');
});

test("buildModel calcule la moyenne (compute average) des inputs", () => {
  const config = {
    meta: {}, scenario: { spiral: {}, noSpiral: {}, thresholds: [] },
    sections: [{ id: '03', title: 'X', cards: [
      { id: 'ism', label: 'ISM', decimals: 0, compute: 'average', inputs: ['a', 'b'],
        fallback: { value: 0, history: [] } },
    ] }],
  };
  const fetched = { a: { value: 20, history: [18, 20] }, b: { value: 30, history: [28, 30] } };
  const card = buildModel(config, fetched).sections[0].cards[0];
  assert.equal(card.value, 25);
  assert.deepEqual(card.history, [23, 25]);
  assert.equal(card.stale, false);
});

test("buildModel average : un input manquant → moyenne des disponibles", () => {
  const config = {
    meta: {}, scenario: { spiral: {}, noSpiral: {}, thresholds: [] },
    sections: [{ id: '03', title: 'X', cards: [
      { id: 'ism', label: 'ISM', decimals: 0, compute: 'average', inputs: ['a', 'b'],
        fallback: { value: 99, history: [] } },
    ] }],
  };
  const card = buildModel(config, { a: { value: 40, history: [40] } }).sections[0].cards[0];
  assert.equal(card.value, 40);
});

test("buildModel average : aucun input → fallback + stale", () => {
  const config = {
    meta: {}, scenario: { spiral: {}, noSpiral: {}, thresholds: [] },
    sections: [{ id: '03', title: 'X', cards: [
      { id: 'ism', label: 'ISM', decimals: 0, compute: 'average', inputs: ['a', 'b'],
        fallback: { value: 25, history: [25] } },
    ] }],
  };
  const card = buildModel(config, {}).sections[0].cards[0];
  assert.equal(card.value, 25);
  assert.equal(card.stale, true);
});

test("buildModel ignore un badge IA sur une carte live (source non config)", () => {
  const config = {
    meta: {}, scenario: { spiral: {}, noSpiral: {}, thresholds: [] },
    sections: [{ id: '03', title: 'X', cards: [
      { id: 'swap5y5y', label: 'Swap', decimals: 2, suffix: '%',
        source: { type: 'fred', series: 'T5YIFR' },
        fallback: { value: 2.29, history: [2.29] },
        badge: { text: 'STABLE', tone: 'ok' } },
    ] }],
  };
  // Cache IA antérieur (avant que la carte ne passe en live) qui voulait écraser :
  const ai = { scenario: { spiral: {}, noSpiral: {}, thresholds: [] },
    editorialBadges: { swap5y5y: { text: 'DÉRIVE LENTE', tone: 'warn' } } };
  const card = buildModel(config, {}, ai).sections[0].cards[0];
  assert.deepEqual(card.badge, { text: 'STABLE', tone: 'ok' }); // badge live, pas IA
});
