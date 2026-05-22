import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sparklinePath, renderHtml } from '../src/render.js';

test('sparklinePath renvoie "" pour une série vide', () => {
  assert.equal(sparklinePath([], 100, 30), '');
});

test('sparklinePath commence par M et contient des L', () => {
  const d = sparklinePath([1, 2, 3, 2, 4], 100, 30);
  assert.match(d, /^M/);
  assert.match(d, /L/);
});

test('sparklinePath gère une série constante (pas de NaN)', () => {
  const d = sparklinePath([5, 5, 5], 100, 30);
  assert.doesNotMatch(d, /NaN/);
});

test('renderHtml contient le titre et les sections', () => {
  const model = {
    meta: { title: 'Régime IPHR', subtitle: 'DASHBOARD', sources: 'src', refreshedAt: '2026-05-22T00:00:00Z' },
    sections: [{ id: '01', title: 'OIL', cards: [
      { id: 'brent', label: 'Brent Crude', sourceTag: '$/bbl', displayValue: '$109.3',
        context: 'ctx', badge: { text: 'CHOC', tone: 'alert' }, history: [1, 2, 3], stale: false },
    ] }],
    scenario: { spiral: { label: 'Spirale', probability: '25 %', bullets: ['a'] },
                noSpiral: { label: 'Pas de spirale', probability: '75 %', bullets: ['b'] },
                thresholds: ['t1'] },
  };
  const html = renderHtml(model);
  assert.match(html, /Régime IPHR/);
  assert.match(html, /Brent Crude/);
  assert.match(html, /\$109\.3/);
  assert.match(html, /tone-alert/);
  assert.match(html, /Spirale/);
  assert.match(html, /t1/);
});

test("renderHtml ignore les cartes hidden", () => {
  const model = {
    meta: {}, scenario: { spiral: {}, noSpiral: {}, thresholds: [] },
    sections: [{ id: '01', title: 'OIL', cards: [
      { id: 'rbob', label: '_rbob', hidden: true, displayValue: '2.6', badge: null, history: [], stale: false },
    ] }],
  };
  assert.doesNotMatch(renderHtml(model), /_rbob/);
});
