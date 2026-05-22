# IPHR Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recréer en Node.js le dashboard macro/marchés « Régime IPHR », données live (FRED + Yahoo) avec fallback config, et le déployer sur le k3s de gheop.com à `iphr.gheop.com`.

**Architecture:** Service Express unique. Un scheduler rafraîchit FRED/Yahoo et écrit un cache JSON disque. `compute.js` assemble un modèle (valeurs live ou fallback config, badges par seuils, crack spread). `server.js` rend le HTML (SSR) et expose `/api/data`. Frontend léger, sparklines SVG. Déploiement calqué sur `reader` : build → GHCR → SSH `kubectl set image`.

**Tech Stack:** Node 22 LTS, Express, `node:test` (runner intégré), `fetch` global. Aucune dépendance de charting. Docker, GitHub Actions, k3s/Traefik.

---

## File Structure

```
package.json              # deps (express), scripts (start, test)
.gitignore                # node_modules, data/, .env
.dockerignore
.env.example              # FRED_API_KEY, PORT, REFRESH_INTERVAL_MIN
Dockerfile
config/indicators.json    # méta, sections, cartes (source/seuils/fallback), scénario
src/
  cache.js                # readCache / writeCache (JSON disque tolérant)
  sources/fred.js         # parseFredObservations / fetchFredSeries
  sources/yahoo.js        # parseYahooChart / fetchYahooSymbol
  compute.js              # crackSpread, thousandsToMb, evaluateBadge, buildModel
  render.js               # formatValue, sparklinePath, renderHtml
  scheduler.js            # refresh (fetch + cache), start (intervalle)
  server.js               # Express : / , /api/data , /healthz
public/
  styles.css              # thème sombre
  app.js                  # poll /api/data, redessine sparklines
test/
  cache.test.js
  fred.test.js
  yahoo.test.js
  compute.test.js
  render.test.js
.github/workflows/deploy.yml
k3s/                      # copié manuellement vers Gheop/k3s/iphr/
  namespace.yaml service.yaml deployment.yaml ingress.yaml secrets.yaml.example
README.md
```

**Data model** (produit par `buildModel`, consommé par `render`/`server`) :

```js
{
  meta: { title, subtitle, dateLabel, sources, refreshedAt },
  sections: [ { id, title, cards: [card] } ],
  scenario: { spiral:{label,probability,bullets[]}, noSpiral:{...}, thresholds:[string] }
}
// card:
{ id, label, sourceTag, prefix, suffix, decimals,
  value:Number|null, displayValue:String, context,
  badge:{text,tone}, history:[Number], stale:Boolean }
// tone ∈ "alert" | "warn" | "ok" | "neutral"
```

---

## Task 1: Scaffold du projet

**Files:**
- Create: `package.json`, `.gitignore`, `.dockerignore`, `.env.example`

- [ ] **Step 1: Écrire `package.json`**

```json
{
  "name": "iphr",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test"
  },
  "dependencies": {
    "express": "^4.21.2"
  }
}
```

- [ ] **Step 2: Écrire `.gitignore`**

```
node_modules/
data/
.env
*.log
```

- [ ] **Step 3: Écrire `.dockerignore`**

```
node_modules
data
.git
.github
docs
*.png
.env
```

- [ ] **Step 4: Écrire `.env.example`**

```
FRED_API_KEY=
PORT=8080
REFRESH_INTERVAL_MIN=30
```

- [ ] **Step 5: Installer les deps et vérifier**

Run: `npm install && node --test 2>&1 | tail -3`
Expected: `npm install` réussit ; `node --test` ne trouve aucun test (exit 0, « tests 0 »).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore .dockerignore .env.example
git commit -m "chore: scaffold projet iphr"
```

---

## Task 2: Cache JSON disque

**Files:**
- Create: `src/cache.js`, `test/cache.test.js`

- [ ] **Step 1: Écrire le test (`test/cache.test.js`)**

```js
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
```

- [ ] **Step 2: Lancer le test → échec**

Run: `node --test test/cache.test.js`
Expected: FAIL — `Cannot find module '../src/cache.js'`.

- [ ] **Step 3: Écrire `src/cache.js`**

```js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function readCache(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

export function writeCache(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2));
}
```

- [ ] **Step 4: Lancer le test → succès**

Run: `node --test test/cache.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cache.js test/cache.test.js
git commit -m "feat: cache JSON disque tolérant aux erreurs"
```

---

## Task 3: Source FRED

**Files:**
- Create: `src/sources/fred.js`, `test/fred.test.js`

FRED `series/observations` renvoie `{ "observations": [ { "date": "...", "value": "5.14" }, ... ] }`. Les valeurs manquantes valent `"."`. On garde les ~60 dernières valeurs numériques ; `value` = la dernière.

- [ ] **Step 1: Écrire le test (`test/fred.test.js`)**

```js
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

test('parseFredObservations limite l’historique à 60 points', () => {
  const obs = Array.from({ length: 100 }, (_, i) => ({ date: `d${i}`, value: String(i) }));
  const { history, value } = parseFredObservations({ observations: obs });
  assert.equal(history.length, 60);
  assert.equal(history[0], 40);
  assert.equal(value, 99);
});

test('fetchFredSeries construit l’URL avec la clé et parse la réponse', async () => {
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

test('fetchFredSeries jette si la réponse n’est pas ok', async () => {
  const fakeFetch = async () => ({ ok: false, status: 429 });
  await assert.rejects(() => fetchFredSeries('DGS30', 'KEY', fakeFetch), /429/);
});
```

- [ ] **Step 2: Lancer le test → échec**

Run: `node --test test/fred.test.js`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Écrire `src/sources/fred.js`**

```js
const MAX_HISTORY = 60;

export function parseFredObservations(json) {
  const nums = (json.observations || [])
    .map((o) => Number(o.value))
    .filter((n) => Number.isFinite(n));
  const history = nums.slice(-MAX_HISTORY);
  return { value: history.length ? history[history.length - 1] : null, history };
}

export async function fetchFredSeries(seriesId, apiKey, fetchImpl = fetch) {
  const url =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${encodeURIComponent(seriesId)}` +
    `&api_key=${encodeURIComponent(apiKey)}` +
    `&file_type=json&sort_order=asc&limit=200`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`FRED ${seriesId} HTTP ${res.status}`);
  return parseFredObservations(await res.json());
}
```

- [ ] **Step 4: Lancer le test → succès**

Run: `node --test test/fred.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sources/fred.js test/fred.test.js
git commit -m "feat: client FRED (parse + fetch série)"
```

---

## Task 4: Source Yahoo Finance

**Files:**
- Create: `src/sources/yahoo.js`, `test/yahoo.test.js`

Yahoo `v8/finance/chart/<symbol>` renvoie `{ chart: { result: [ { meta:{regularMarketPrice}, indicators:{quote:[{close:[...]}]} } ] } }`. On filtre les `close` nuls, garde ~60 points, `value` = `regularMarketPrice` (ou dernier close).

- [ ] **Step 1: Écrire le test (`test/yahoo.test.js`)**

```js
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

test('fetchYahooSymbol construit l’URL et parse', async () => {
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
```

- [ ] **Step 2: Lancer le test → échec**

Run: `node --test test/yahoo.test.js`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Écrire `src/sources/yahoo.js`**

```js
const MAX_HISTORY = 60;

export function parseYahooChart(json) {
  const r = json?.chart?.result?.[0];
  if (!r) return { value: null, history: [] };
  const closes = (r.indicators?.quote?.[0]?.close || []).filter((n) => Number.isFinite(n));
  const history = closes.slice(-MAX_HISTORY);
  const last = history.length ? history[history.length - 1] : null;
  const value = Number.isFinite(r.meta?.regularMarketPrice) ? r.meta.regularMarketPrice : last;
  return { value, history };
}

export async function fetchYahooSymbol(symbol, fetchImpl = fetch) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=3mo&interval=1d`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0 iphr-dashboard' } });
  if (!res.ok) throw new Error(`Yahoo ${symbol} HTTP ${res.status}`);
  return parseYahooChart(await res.json());
}
```

- [ ] **Step 4: Lancer le test → succès**

Run: `node --test test/yahoo.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sources/yahoo.js test/yahoo.test.js
git commit -m "feat: client Yahoo Finance (parse + fetch chart)"
```

---

## Task 5: Calculs (crack spread, badges, modèle)

**Files:**
- Create: `src/compute.js`, `test/compute.test.js`

Responsabilités :
- `crackSpread321(cl, rb, ho)` : RBOB/HO en $/gal → ×42 ; spread « 3-2-1 » par baril = `(2·rb·42 + ho·42 − 3·cl) / 3`.
- `thousandsToMb(x)` : `x / 1000` (séries FRED stocks en milliers de barils → millions).
- `evaluateBadge(value, rules, staticBadge)` : première règle satisfaite gagne ; sinon `staticBadge`.
- `buildModel(config, fetched)` : assemble le modèle. Pour chaque carte, prend `fetched[cardId]` (si présent et `value` non null) sinon `card.fallback` et marque `stale:true`. Applique transform (`thousandsToMb` si `card.transform === "thousandsToMb"`), `crackSpread` si `card.compute === "crackSpread321"` (à partir des `fetched` des symboles `card.inputs`). Calcule le badge.

Règle (`rules`) : `{ op: ">="|">"|"<="|"<"|"==", value:Number, text, tone }`.

- [ ] **Step 1: Écrire le test (`test/compute.test.js`)**

```js
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
```

- [ ] **Step 2: Lancer le test → échec**

Run: `node --test test/compute.test.js`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Écrire `src/compute.js`**

```js
const GAL_PER_BBL = 42;

export function crackSpread321(cl, rb, ho) {
  return (2 * rb * GAL_PER_BBL + ho * GAL_PER_BBL - 3 * cl) / 3;
}

export function thousandsToMb(x) {
  return x / 1000;
}

const OPS = {
  '>=': (a, b) => a >= b,
  '>': (a, b) => a > b,
  '<=': (a, b) => a <= b,
  '<': (a, b) => a < b,
  '==': (a, b) => a === b,
};

export function evaluateBadge(value, rules, staticBadge) {
  if (Array.isArray(rules) && Number.isFinite(value)) {
    for (const r of rules) {
      const op = OPS[r.op];
      if (op && op(value, r.value)) return { text: r.text, tone: r.tone };
    }
  }
  return staticBadge || null;
}

function formatValue(value, { decimals = 0, prefix = '', suffix = '' } = {}) {
  if (!Number.isFinite(value)) return '—';
  return `${prefix}${value.toFixed(decimals)}${suffix}`;
}

function resolveCard(card, fetched) {
  // 1. crack spread calculé
  if (card.compute === 'crackSpread321') {
    const { cl, rb, ho } = card.inputs;
    const f = fetched;
    if (f[cl]?.value != null && f[rb]?.value != null && f[ho]?.value != null) {
      const v = crackSpread321(f[cl].value, f[rb].value, f[ho].value);
      return { value: v, history: [], stale: false };
    }
    return { value: card.fallback.value, history: card.fallback.history || [], stale: true };
  }
  // 2. source live (fred/yahoo)
  const live = fetched[card.id];
  if (live && live.value != null) {
    let value = live.value;
    let history = live.history || [];
    if (card.transform === 'thousandsToMb') {
      value = thousandsToMb(value);
      history = history.map(thousandsToMb);
    }
    return { value, history, stale: false };
  }
  // 3. fallback config
  return { value: card.fallback.value, history: card.fallback.history || [], stale: true };
}

export function buildModel(config, fetched) {
  const sections = config.sections.map((section) => ({
    id: section.id,
    title: section.title,
    cards: section.cards.map((card) => {
      const { value, history, stale } = resolveCard(card, fetched);
      return {
        id: card.id,
        label: card.label,
        sourceTag: card.sourceTag || '',
        prefix: card.prefix || '',
        suffix: card.suffix || '',
        decimals: card.decimals ?? 0,
        value,
        displayValue: formatValue(value, card),
        context: card.context || '',
        badge: evaluateBadge(value, card.rules, card.badge),
        history,
        stale,
      };
    }),
  }));
  return {
    meta: { ...config.meta, refreshedAt: new Date().toISOString() },
    sections,
    scenario: config.scenario,
  };
}
```

- [ ] **Step 4: Lancer le test → succès**

Run: `node --test test/compute.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/compute.js test/compute.test.js
git commit -m "feat: calculs crack spread, badges et assemblage du modèle"
```

---

## Task 6: Configuration des indicateurs

**Files:**
- Create: `config/indicators.json`

Reprend les libellés/valeurs/contextes lus sur les captures. Valeurs `fallback` = valeurs des captures ; `history` fallback = courte série plausible (≈12 points) pour que la sparkline s'affiche avant le premier fetch. Les cartes `source.type` `fred`/`yahoo` ont un `id` qui sert de clé dans `fetched`.

- [ ] **Step 1: Écrire `config/indicators.json`**

```json
{
  "meta": {
    "title": "Régime IPHR — Inflation-Push Hawkish Repricing",
    "subtitle": "DASHBOARD",
    "sources": "Bloomberg · FMP · Data Puller V2 — données J+1/J · choc Hormuz démarré février 2026"
  },
  "sections": [
    {
      "id": "01", "title": "LE CHOC PÉTROLIER",
      "cards": [
        { "id": "brent", "label": "Brent Crude", "sourceTag": "$/bbl · BBG CO1", "prefix": "$", "decimals": 1,
          "source": { "type": "yahoo", "symbol": "BZ=F" }, "context": "+81 % vs plus bas 12 mois",
          "rules": [{ "op": ">=", "value": 90, "text": "CHOC", "tone": "alert" }],
          "fallback": { "value": 109.3, "history": [60,62,65,70,78,85,92,98,103,107,108,109.3] } },
        { "id": "wti", "label": "WTI Crude", "sourceTag": "$/bbl · BBG CL1", "prefix": "$", "decimals": 1,
          "source": { "type": "yahoo", "symbol": "CL=F" }, "context": "+78 % vs plus bas 12 mois",
          "rules": [{ "op": ">=", "value": 88, "text": "CHOC", "tone": "alert" }],
          "fallback": { "value": 105.4, "history": [58,60,63,68,75,82,89,95,99,103,104,105.4] } },
        { "id": "crack", "label": "Crack Spread 3-2-1", "sourceTag": "$/bbl · BBG CRK321R", "prefix": "$", "decimals": 1,
          "compute": "crackSpread321", "inputs": { "cl": "wti", "rb": "rbob", "ho": "ho" },
          "context": "vs normale ≈ $20",
          "rules": [{ "op": ">=", "value": 40, "text": "RAFFINAGE", "tone": "warn" }],
          "fallback": { "value": 54.7, "history": [20,22,25,28,33,38,44,49,52,54,55,54.7] } },
        { "id": "rbob", "label": "_rbob", "source": { "type": "yahoo", "symbol": "RB=F" }, "hidden": true,
          "fallback": { "value": 2.6, "history": [2.6] } },
        { "id": "ho", "label": "_ho", "source": { "type": "yahoo", "symbol": "HO=F" }, "hidden": true,
          "fallback": { "value": 2.7, "history": [2.7] } },
        { "id": "backwardation", "label": "Backwardation Brent", "sourceTag": "Jul 26 vs Dec 27 · BBG", "suffix": " %", "decimals": 0,
          "source": { "type": "config" }, "context": "$110 → $79 sur 17 mois", "badge": { "text": "ANTICIPATION", "tone": "ok" },
          "fallback": { "value": -28, "history": [-5,-8,-12,-15,-18,-20,-23,-25,-26,-27,-28,-28] } }
      ]
    },
    {
      "id": "02", "title": "SIGNAL DE MARCHÉ : TAUX, DOLLAR, VOLATILITÉ",
      "cards": [
        { "id": "ust30", "label": "Treasury US 30 ans", "sourceTag": "% · FMP", "suffix": "%", "decimals": 2,
          "source": { "type": "fred", "series": "DGS30" }, "context": "niveau 2007",
          "rules": [{ "op": ">=", "value": 5, "text": "≥ 5%", "tone": "warn" }],
          "fallback": { "value": 5.14, "history": [4.2,4.3,4.5,4.6,4.7,4.8,4.9,5.0,5.05,5.1,5.12,5.14] } },
        { "id": "be10", "label": "Breakeven 10 ans", "sourceTag": "% · FRED", "suffix": "%", "decimals": 2,
          "source": { "type": "fred", "series": "T10YIE" }, "context": "stable",
          "rules": [{ "op": ">=", "value": 2.6, "text": "À SURVEILLER", "tone": "warn" }],
          "badge": { "text": "STABLE", "tone": "ok" },
          "fallback": { "value": 2.48, "history": [2.3,2.32,2.35,2.38,2.4,2.42,2.44,2.45,2.46,2.47,2.48,2.48] } },
        { "id": "move", "label": "MOVE Index", "sourceTag": "vol obligataire", "decimals": 0,
          "source": { "type": "yahoo", "symbol": "^MOVE" }, "context": "+28 % en 10 jours",
          "rules": [{ "op": ">=", "value": 130, "text": "SPIKE", "tone": "alert" }],
          "badge": { "text": "SPIKE", "tone": "alert" },
          "fallback": { "value": 86, "history": [60,62,65,68,70,72,75,78,80,83,85,86] } },
        { "id": "hyoas", "label": "High Yield OAS", "sourceTag": "bps · FRED", "suffix": " bps", "decimals": 0, "transform": "bpsFromPct",
          "source": { "type": "fred", "series": "BAMLH0A0HYM2" }, "context": "pas de stress crédit",
          "rules": [{ "op": ">=", "value": 290, "text": "CALME", "tone": "ok" }],
          "badge": { "text": "CALME", "tone": "ok" },
          "fallback": { "value": 280, "history": [310,305,300,298,295,292,290,288,285,283,281,280] } }
      ]
    },
    {
      "id": "03", "title": "ANTICIPATIONS D'INFLATION",
      "cards": [
        { "id": "michigan1y", "label": "Michigan 1 an", "sourceTag": "anticip. ménages", "suffix": "%", "decimals": 1,
          "source": { "type": "fred", "series": "MICH" }, "context": "panique ménages",
          "rules": [{ "op": ">=", "value": 4, "text": "ÉLEVÉ", "tone": "alert" }],
          "fallback": { "value": 4.7, "history": [3.0,3.2,3.4,3.6,3.9,4.1,4.3,4.4,4.5,4.6,4.7,4.7] } },
        { "id": "swap5y5y", "label": "5Y5Y Inflation Swap", "sourceTag": "%", "suffix": "%", "decimals": 2,
          "source": { "type": "config" }, "context": "+17 bps depuis 1 mois", "badge": { "text": "PROCHE SEUIL", "tone": "warn" },
          "fallback": { "value": 2.47, "history": [2.3,2.32,2.35,2.38,2.4,2.42,2.43,2.44,2.45,2.46,2.47,2.47] } },
        { "id": "tips5y5y", "label": "5Y5Y Forward TIPS", "sourceTag": "% · FRED", "suffix": "%", "decimals": 2,
          "source": { "type": "fred", "series": "T5YIFR" }, "context": "marché encore ancré",
          "rules": [{ "op": ">=", "value": 2.6, "text": "PROCHE SEUIL", "tone": "warn" }],
          "badge": { "text": "ANCRÉ", "tone": "ok" },
          "fallback": { "value": 2.27, "history": [2.2,2.21,2.22,2.23,2.24,2.25,2.25,2.26,2.26,2.27,2.27,2.27] } },
        { "id": "ismprices", "label": "ISM Prices Paid", "sourceTag": "mfg", "decimals": 1,
          "source": { "type": "config" }, "context": "+26 pts en 4 mois", "badge": { "text": "HOT", "tone": "alert" },
          "fallback": { "value": 84.6, "history": [58,60,63,67,71,74,77,80,82,83,84,84.6] } }
      ]
    },
    {
      "id": "04", "title": "STOCKS PÉTROLIERS",
      "cards": [
        { "id": "spr", "label": "SPR US", "sourceTag": "millions bbl · FRED", "suffix": " mb", "decimals": 0, "transform": "thousandsToMb",
          "source": { "type": "fred", "series": "WCSSTUS1" }, "context": "-209 mb vs 2022", "badge": { "text": "VIDE", "tone": "alert" },
          "fallback": { "value": 384, "history": [600,560,520,480,450,430,415,405,398,392,387,384] } },
        { "id": "crude", "label": "US Commercial Crude", "sourceTag": "millions bbl · FRED", "suffix": " mb", "decimals": 0, "transform": "thousandsToMb",
          "source": { "type": "fred", "series": "WCESTUS1" }, "context": "-13 mb en 3 semaines", "badge": { "text": "DRAW", "tone": "warn" },
          "fallback": { "value": 453, "history": [475,472,470,468,466,464,462,460,458,456,454,453] } },
        { "id": "oecd", "label": "OECD On-land Total", "sourceTag": "millions bbl", "suffix": " mb", "decimals": 0,
          "source": { "type": "config" }, "context": "janv. 26 → avril 26 : -146 mb", "badge": { "text": "EN BAISSE", "tone": "warn" },
          "fallback": { "value": 4075, "history": [4280,4250,4220,4200,4180,4160,4140,4120,4100,4090,4080,4075] } },
        { "id": "floating", "label": "Floating Storage", "sourceTag": "millions bbl", "suffix": " mb", "decimals": 0,
          "source": { "type": "config" }, "context": "à la moyenne", "badge": { "text": "NORMAL", "tone": "neutral" },
          "fallback": { "value": 105, "history": [120,118,115,113,111,110,109,108,107,106,105,105] } }
      ]
    },
    {
      "id": "05", "title": "SALAIRES",
      "cards": [
        { "id": "atlantawage", "label": "Atlanta Fed Wage Tracker", "sourceTag": "% · FRED", "suffix": "%", "decimals": 1,
          "source": { "type": "fred", "series": "FRBATLWGT3MMAUMHWGO" }, "context": "décélère",
          "rules": [{ "op": ">=", "value": 4.5, "text": "TENDU", "tone": "warn" }],
          "badge": { "text": "VERROU OK", "tone": "ok" },
          "fallback": { "value": 3.6, "history": [6.1,5.8,5.5,5.1,4.8,4.5,4.2,4.0,3.9,3.8,3.7,3.6] } },
        { "id": "euwage", "label": "Salaires négociés EU", "sourceTag": "% · ECB Wage Tracker", "suffix": "%", "decimals": 1,
          "source": { "type": "config" }, "context": "4,7 % → 2,6 % (décélère)", "badge": { "text": "VERROU OK", "tone": "ok" },
          "fallback": { "value": 2.6, "history": [4.7,4.5,4.2,3.9,3.6,3.3,3.1,2.9,2.8,2.7,2.6,2.6] } }
      ]
    }
  ],
  "scenario": {
    "spiral": {
      "label": "Scénario spirale", "probability": "≈ 25-30 %",
      "bullets": [
        "Ménages déjà en panique → Michigan 1 an à 4,8 %",
        "5Y5Y swap à 8 bps de casser 2,55 %",
        "ISM Prices Paid 84,6 → pricing power au plus haut",
        "Si Hormuz dure > 12 mois, le choc devient structurel",
        "Crack spreads records → pass-through diesel diffusant"
      ]
    },
    "noSpiral": {
      "label": "Pas de spirale", "probability": "≈ 70-75 %",
      "bullets": [
        "Salaires en décélération US (3,6 %) ET EU (2,6 %)",
        "FMI : 75 % des épisodes prix+salaires ne spiralent pas",
        "Michigan long terme qui plafonne à 3,4 %",
        "Backwardation oil -28 % → le marché price un retour normal",
        "Fed Warsh hawkish → crédibilité préservée"
      ]
    },
    "thresholds": [
      "Discours Warsh — 1ʳᵉ conf. FOMC 17 juin 2026",
      "5Y5Y swap > 2,80 %",
      "Atlanta wage > 4,5 % ↑",
      "HY OAS > 290 bps",
      "SPR > 347 mb"
    ]
  }
}
```

- [ ] **Step 2: Vérifier que le JSON est valide**

Run: `node -e "JSON.parse(require('fs').readFileSync('config/indicators.json','utf8')); console.log('json ok')"`
Expected: `json ok`.

- [ ] **Step 3: Note sur `transform: "bpsFromPct"`**

`BAMLH0A0HYM2` est en points de pourcentage (ex. 2.80 = 280 bps). Il faut donc multiplier par 100. Ajouter ce transform dans `compute.js` (Task 7 le couvre par un test). Si l'agent exécute les tâches dans l'ordre, ajouter le cas maintenant dans `resolveCard` :

```js
// dans resolveCard, branche source live, après thousandsToMb :
if (card.transform === 'bpsFromPct') {
  value = value * 100;
  history = history.map((h) => h * 100);
}
```

- [ ] **Step 4: Commit**

```bash
git add config/indicators.json src/compute.js
git commit -m "feat: config des indicateurs (valeurs des captures en fallback)"
```

---

## Task 7: Transform bpsFromPct testé

**Files:**
- Modify: `src/compute.js` (déjà ajouté en Task 6 Step 3 si fait), `test/compute.test.js`

- [ ] **Step 1: Ajouter le test dans `test/compute.test.js`**

```js
test('buildModel applique bpsFromPct (pct → bps)', () => {
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
```

- [ ] **Step 2: Lancer → vérifier**

Run: `node --test test/compute.test.js`
Expected: PASS (8 tests). Si le transform n'a pas été ajouté en Task 6, l'ajouter maintenant dans `resolveCard` (voir Task 6 Step 3) et relancer.

- [ ] **Step 3: Commit**

```bash
git add src/compute.js test/compute.test.js
git commit -m "test: couvre le transform bpsFromPct"
```

---

## Task 8: Rendu HTML + sparklines SVG

**Files:**
- Create: `src/render.js`, `test/render.test.js`

`sparklinePath(history, w, h)` : normalise la série sur `[0,w]×[h,0]`, renvoie le `d` d'une polyline (`M x y L x y ...`). Série vide → `''`. Série constante → ligne horizontale médiane.
`renderHtml(model)` : page complète. Ignore les cartes `hidden`. Couleur via classe `tone-<tone>` et `stale`.

- [ ] **Step 1: Écrire le test (`test/render.test.js`)**

```js
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

test('renderHtml ignore les cartes hidden', () => {
  const model = {
    meta: {}, scenario: { spiral: {}, noSpiral: {}, thresholds: [] },
    sections: [{ id: '01', title: 'OIL', cards: [
      { id: 'rbob', label: '_rbob', hidden: true, displayValue: '2.6', badge: null, history: [], stale: false },
    ] }],
  };
  assert.doesNotMatch(renderHtml(model), /_rbob/);
});
```

- [ ] **Step 2: Lancer → échec**

Run: `node --test test/render.test.js`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Écrire `src/render.js`**

```js
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function sparklinePath(history, w = 120, h = 36) {
  const pts = (history || []).filter((n) => Number.isFinite(n));
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M0,${h / 2} L${w},${h / 2}`;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const step = w / (pts.length - 1);
  return pts
    .map((v, i) => {
      const x = (i * step).toFixed(2);
      const y = (h - ((v - min) / span) * h).toFixed(2);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
}

function renderCard(card) {
  if (card.hidden) return '';
  const badge = card.badge
    ? `<span class="badge tone-${esc(card.badge.tone)}">${esc(card.badge.text)}</span>`
    : '';
  const stale = card.stale ? '<span class="stale" title="valeur en cache">•</span>' : '';
  const d = sparklinePath(card.history);
  return `
    <article class="card${card.stale ? ' is-stale' : ''}" data-id="${esc(card.id)}">
      <header><span class="card-label">${esc(card.label)}</span>${badge}</header>
      <div class="card-tag">${esc(card.sourceTag)}</div>
      <div class="card-value">${esc(card.displayValue)}${stale}</div>
      <div class="card-context">${esc(card.context)}</div>
      <svg class="spark tone-${esc(card.badge?.tone || 'neutral')}" viewBox="0 0 120 36" preserveAspectRatio="none">
        <path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5"/>
      </svg>
    </article>`;
}

function renderSection(section) {
  const cards = section.cards.map(renderCard).join('');
  return `<section class="block">
    <h2 class="block-title"><span>${esc(section.id)}</span> — ${esc(section.title)}</h2>
    <div class="grid">${cards}</div>
  </section>`;
}

function renderScenario(s) {
  const list = (arr) => (arr || []).map((b) => `<li>${esc(b)}</li>`).join('');
  return `<section class="scenario">
    <div class="scen scen-spiral">
      <h3>${esc(s.spiral.label)} <span>${esc(s.spiral.probability)}</span></h3>
      <ul>${list(s.spiral.bullets)}</ul>
    </div>
    <div class="scen scen-nospiral">
      <h3>${esc(s.noSpiral.label)} <span>${esc(s.noSpiral.probability)}</span></h3>
      <ul>${list(s.noSpiral.bullets)}</ul>
    </div>
  </section>
  <section class="thresholds">
    <h3>Seuils de bascule à surveiller</h3>
    <ul>${list(s.thresholds)}</ul>
  </section>`;
}

export function renderHtml(model) {
  const date = new Date(model.meta.refreshedAt || Date.now()).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(model.meta.title || 'IPHR')}</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main>
    <header class="page-head">
      <h1>${esc(model.meta.title)}</h1>
      <div class="meta-row">
        <span class="pill">${esc(model.meta.subtitle)} · ${esc(date)}</span>
        <span class="sources">${esc(model.meta.sources)}</span>
      </div>
    </header>
    ${model.sections.map(renderSection).join('')}
    ${renderScenario(model.scenario)}
  </main>
  <script src="/app.js"></script>
</body>
</html>`;
}
```

- [ ] **Step 4: Lancer → succès**

Run: `node --test test/render.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render.js test/render.test.js
git commit -m "feat: rendu HTML SSR et sparklines SVG"
```

---

## Task 9: Scheduler (fetch + cache)

**Files:**
- Create: `src/scheduler.js`

`refresh(config, deps)` : pour chaque carte avec `source.type` `fred`/`yahoo`, appelle la source ; en cas d'échec, log et réutilise la valeur du cache précédent si dispo. Écrit `data/cache.json`. Renvoie l'objet `fetched` (clé = card.id).
`deps` = `{ fredKey, fetchFred, fetchYahoo, cachePath, log }` (injectables pour test).

- [ ] **Step 1: Écrire `src/scheduler.js`**

```js
import { readCache, writeCache } from './cache.js';
import { fetchFredSeries } from './sources/fred.js';
import { fetchYahooSymbol } from './sources/yahoo.js';

const CACHE_PATH = process.env.CACHE_PATH || 'data/cache.json';

export async function refresh(config, deps = {}) {
  const {
    fredKey = process.env.FRED_API_KEY,
    fetchFred = fetchFredSeries,
    fetchYahoo = fetchYahooSymbol,
    cachePath = CACHE_PATH,
    log = console,
  } = deps;

  const prev = readCache(cachePath);
  const fetched = { ...prev };

  for (const section of config.sections) {
    for (const card of section.cards) {
      const src = card.source;
      if (!src || src.type === 'config') continue;
      try {
        if (src.type === 'fred') {
          if (!fredKey) throw new Error('FRED_API_KEY manquante');
          fetched[card.id] = await fetchFred(src.series, fredKey);
        } else if (src.type === 'yahoo') {
          fetched[card.id] = await fetchYahoo(src.symbol);
        }
      } catch (err) {
        log.warn?.(`[refresh] ${card.id}: ${err.message} (cache conservé)`);
        if (!fetched[card.id]) fetched[card.id] = { value: null, history: [] };
      }
    }
  }

  writeCache(cachePath, fetched);
  return fetched;
}

export function start(config, onUpdate, deps = {}) {
  const intervalMin = Number(process.env.REFRESH_INTERVAL_MIN || 30);
  const run = async () => {
    try {
      onUpdate(await refresh(config, deps));
    } catch (err) {
      (deps.log || console).error?.(`[scheduler] ${err.message}`);
    }
  };
  run();
  const timer = setInterval(run, intervalMin * 60 * 1000);
  timer.unref?.();
  return timer;
}
```

- [ ] **Step 2: Vérifier le chargement du module**

Run: `node -e "import('./src/scheduler.js').then(m => console.log(typeof m.refresh, typeof m.start))"`
Expected: `function function`.

- [ ] **Step 3: Test d'intégration léger du refresh**

Create test ad hoc — ajouter `test/scheduler.test.js` :

```js
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

test('refresh remplit fetched depuis fred/yahoo et ignore config', async () => {
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

test('refresh conserve le cache précédent quand une source échoue', async () => {
  const cachePath = join(mkdtempSync(join(tmpdir(), 'iphr-')), 'cache.json');
  await refresh(config, { fredKey: 'K', fetchFred: async () => ({ value: 5.0, history: [5.0] }),
    fetchYahoo: async () => ({ value: 100, history: [100] }), cachePath, log: { warn() {} } });
  const fetched = await refresh(config, { fredKey: 'K',
    fetchFred: async () => { throw new Error('boom'); },
    fetchYahoo: async () => ({ value: 110, history: [110] }), cachePath, log: { warn() {} } });
  assert.equal(fetched.ust30.value, 5.0); // valeur du cache conservée
  assert.equal(fetched.brent.value, 110);
});
```

- [ ] **Step 4: Lancer → succès**

Run: `node --test test/scheduler.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/scheduler.js test/scheduler.test.js
git commit -m "feat: scheduler de rafraîchissement avec repli sur cache"
```

---

## Task 10: Serveur Express

**Files:**
- Create: `src/server.js`

- [ ] **Step 1: Écrire `src/server.js`**

```js
import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildModel } from './compute.js';
import { renderHtml } from './render.js';
import { start } from './scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const config = JSON.parse(readFileSync(join(root, 'config/indicators.json'), 'utf8'));

let model = buildModel(config, {}); // valeurs fallback avant le premier fetch

start(config, (fetched) => {
  model = buildModel(config, fetched);
  console.log(`[iphr] modèle rafraîchi à ${model.meta.refreshedAt}`);
});

const app = express();
app.use(express.static(join(root, 'public')));
app.get('/healthz', (_req, res) => res.status(200).send('ok'));
app.get('/api/data', (_req, res) => res.json(model));
app.get('/', (_req, res) => res.type('html').send(renderHtml(model)));

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`[iphr] écoute sur :${port}`));
```

- [ ] **Step 2: Démarrer le serveur (sans clé FRED → fallback) et tester les routes**

Run:
```bash
PORT=8080 node src/server.js & SRV=$!; sleep 2
curl -s localhost:8080/healthz; echo
curl -s localhost:8080/api/data | head -c 120; echo
curl -s localhost:8080/ | grep -o 'Régime IPHR' | head -1
kill $SRV
```
Expected: `ok` ; un début de JSON ; `Régime IPHR`.

- [ ] **Step 3: Commit**

```bash
git add src/server.js
git commit -m "feat: serveur express (SSR, /api/data, /healthz)"
```

---

## Task 11: Frontend (CSS thème sombre + refresh client)

**Files:**
- Create: `public/styles.css`, `public/app.js`

- [ ] **Step 1: Écrire `public/styles.css`**

```css
:root {
  --bg: #0a0e1a; --panel: #111726; --panel2: #0d1320; --line: #1d2740;
  --text: #e6ebf5; --muted: #7c89a6; --tag: #5b6party;
  --alert: #ff4d6d; --warn: #f5b53d; --ok: #2ee6a6; --neutral: #4d8bff;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 14px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
main { max-width: 1200px; margin: 0 auto; padding: 24px; }
.page-head h1 { font-size: 22px; font-weight: 700; margin: 0 0 8px; }
.meta-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 20px; }
.pill { background: var(--alert); color: #fff; font-size: 11px; font-weight: 700;
  padding: 3px 10px; border-radius: 4px; letter-spacing: .04em; }
.sources { color: var(--muted); font-size: 12px; }
.block-title { font-size: 12px; letter-spacing: .12em; color: var(--neutral);
  text-transform: uppercase; margin: 28px 0 12px; font-weight: 700; }
.block-title span { opacity: .7; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
@media (max-width: 900px) { .grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 560px) { .grid { grid-template-columns: 1fr; } }
.card { background: linear-gradient(180deg, var(--panel), var(--panel2));
  border: 1px solid var(--line); border-radius: 12px; padding: 14px; position: relative; }
.card.is-stale { opacity: .82; }
.card header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.card-label { font-weight: 600; font-size: 13px; }
.badge { font-size: 9.5px; font-weight: 700; padding: 2px 7px; border-radius: 999px;
  letter-spacing: .05em; white-space: nowrap; }
.tone-alert { color: var(--alert); } .badge.tone-alert { background: rgba(255,77,109,.15); }
.tone-warn { color: var(--warn); } .badge.tone-warn { background: rgba(245,181,61,.15); }
.tone-ok { color: var(--ok); } .badge.tone-ok { background: rgba(46,230,166,.15); }
.tone-neutral { color: var(--neutral); } .badge.tone-neutral { background: rgba(77,139,255,.15); }
.card-tag { color: var(--muted); font-size: 10px; font-family: ui-monospace, monospace; margin: 6px 0 10px; }
.card-value { font-size: 30px; font-weight: 700; letter-spacing: -.02em; }
.stale { color: var(--warn); font-size: 14px; margin-left: 6px; vertical-align: super; }
.card-context { color: var(--muted); font-size: 11px; margin-top: 4px; }
.spark { width: 100%; height: 38px; margin-top: 10px; display: block; }
.scenario { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 28px; }
@media (max-width: 700px) { .scenario { grid-template-columns: 1fr; } }
.scen { border-radius: 12px; padding: 16px; border: 1px solid var(--line); }
.scen-spiral { background: rgba(255,77,109,.06); border-color: rgba(255,77,109,.3); }
.scen-nospiral { background: rgba(46,230,166,.06); border-color: rgba(46,230,166,.3); }
.scen h3 { margin: 0 0 10px; font-size: 14px; }
.scen-spiral h3 span { color: var(--alert); } .scen-nospiral h3 span { color: var(--ok); }
.scen ul, .thresholds ul { margin: 0; padding-left: 18px; }
.scen li, .thresholds li { margin: 6px 0; font-size: 12.5px; color: #c2cbe0; }
.thresholds { margin-top: 20px; border: 1px solid var(--line); border-radius: 12px;
  padding: 16px; background: var(--panel2); }
.thresholds h3 { margin: 0 0 10px; font-size: 11px; letter-spacing: .12em;
  text-transform: uppercase; color: var(--muted); }
.thresholds ul { columns: 2; } @media (max-width: 700px) { .thresholds ul { columns: 1; } }
```

Note : corriger la coquille `--tag: #5b6party;` → `--tag: #5b6a8a;` en écrivant le fichier.

- [ ] **Step 2: Écrire `public/app.js`**

```js
// Rafraîchit les valeurs et redessine les sparklines toutes les 60 s, sans recharger la page.
function sparkPath(history, w = 120, h = 36) {
  const pts = (history || []).filter((n) => Number.isFinite(n));
  if (!pts.length) return '';
  if (pts.length === 1) return `M0,${h / 2} L${w},${h / 2}`;
  const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1, step = w / (pts.length - 1);
  return pts.map((v, i) =>
    `${i ? 'L' : 'M'}${(i * step).toFixed(2)},${(h - ((v - min) / span) * h).toFixed(2)}`).join(' ');
}

async function refresh() {
  try {
    const res = await fetch('/api/data', { cache: 'no-store' });
    if (!res.ok) return;
    const model = await res.json();
    for (const section of model.sections) {
      for (const card of section.cards) {
        if (card.hidden) continue;
        const el = document.querySelector(`.card[data-id="${card.id}"]`);
        if (!el) continue;
        el.querySelector('.card-value').firstChild &&
          (el.querySelector('.card-value').childNodes[0].nodeValue = card.displayValue);
        el.classList.toggle('is-stale', !!card.stale);
        const path = el.querySelector('.spark path');
        if (path) path.setAttribute('d', sparkPath(card.history));
      }
    }
  } catch { /* réseau indispo : on garde l'affichage courant */ }
}

setInterval(refresh, 60000);
```

- [ ] **Step 3: Vérifier visuellement**

Run:
```bash
PORT=8080 node src/server.js & SRV=$!; sleep 2
curl -s localhost:8080/ | grep -c 'class="card"'
curl -s localhost:8080/styles.css | head -c 40; echo
kill $SRV
```
Expected: un nombre de cartes > 10 (les `hidden` exclues du HTML) ; le début du CSS.

- [ ] **Step 4: Commit**

```bash
git add public/styles.css public/app.js
git commit -m "feat: frontend thème sombre + refresh client des sparklines"
```

---

## Task 12: Dockerfile

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Écrire `Dockerfile`**

```dockerfile
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY config ./config
COPY public ./public
RUN mkdir -p data && chown -R node:node /app
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
```

- [ ] **Step 2: Build et run local (sudo docker — cf. alias `docker='sudo docker'`)**

Run:
```bash
sudo docker build -t iphr:test .
sudo docker run -d --rm -p 8088:8080 --name iphr-test iphr:test
sleep 2; curl -s localhost:8088/healthz; echo
sudo docker stop iphr-test
```
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "build: image docker node alpine"
```

---

## Task 13: Workflow CI/CD

**Files:**
- Create: `.github/workflows/deploy.yml`

Calqué sur `Gheop/reader` : build → push GHCR → SSH `kubectl set image`. Lance aussi les tests avant build.

- [ ] **Step 1: Écrire `.github/workflows/deploy.yml`**

```yaml
name: Build and Deploy to k3s

on:
  push:
    branches: [master]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: gheop/iphr

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npm test

  deploy:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v6
      - uses: docker/setup-buildx-action@v4
      - name: Log in to GHCR
        uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build and push
        uses: docker/build-push-action@v7
        with:
          context: .
          push: true
          tags: |
            ghcr.io/${{ env.IMAGE_NAME }}:latest
            ghcr.io/${{ env.IMAGE_NAME }}:${{ github.sha }}
          cache-from: type=registry,ref=ghcr.io/${{ env.IMAGE_NAME }}:buildcache
          cache-to: type=registry,ref=ghcr.io/${{ env.IMAGE_NAME }}:buildcache,mode=max
      - name: Deploy to k3s
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          port: ${{ secrets.SSH_PORT }}
          script: |
            export KUBECONFIG=~/.kube/config
            kubectl set image deployment/iphr \
              iphr=ghcr.io/gheop/iphr:${{ github.sha }} -n iphr
            kubectl rollout status deployment/iphr -n iphr --timeout=120s
```

- [ ] **Step 2: Valider la syntaxe YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml')); print('yaml ok')"`
Expected: `yaml ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: build, push GHCR et déploiement k3s par ssh"
```

---

## Task 14: Manifests k3s

**Files:**
- Create: `k3s/namespace.yaml`, `k3s/deployment.yaml`, `k3s/service.yaml`, `k3s/ingress.yaml`, `k3s/secrets.yaml.example`

- [ ] **Step 1: Écrire les 5 manifests**

`k3s/namespace.yaml`
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: iphr
```

`k3s/deployment.yaml`
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: iphr
  namespace: iphr
spec:
  replicas: 1
  selector:
    matchLabels:
      app: iphr
  template:
    metadata:
      labels:
        app: iphr
    spec:
      imagePullSecrets:
        - name: ghcr-pull-secret
      containers:
        - name: iphr
          image: ghcr.io/gheop/iphr:latest
          ports:
            - containerPort: 8080
          envFrom:
            - secretRef:
                name: iphr-app-secrets
          readinessProbe:
            httpGet: { path: /healthz, port: 8080 }
            initialDelaySeconds: 3
            periodSeconds: 10
          livenessProbe:
            httpGet: { path: /healthz, port: 8080 }
            initialDelaySeconds: 10
            periodSeconds: 20
          resources:
            requests: { memory: "64Mi", cpu: "50m" }
            limits: { memory: "256Mi", cpu: "500m" }
```

`k3s/service.yaml`
```yaml
apiVersion: v1
kind: Service
metadata:
  name: iphr
  namespace: iphr
spec:
  type: NodePort
  selector:
    app: iphr
  ports:
    - port: 80
      targetPort: 8080
      nodePort: 30082
```

`k3s/ingress.yaml`
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: iphr
  namespace: iphr
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: websecure
    traefik.ingress.kubernetes.io/router.tls.certresolver: letsencrypt
spec:
  rules:
    - host: iphr.gheop.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: iphr
                port:
                  number: 80
  tls:
    - hosts:
        - iphr.gheop.com
```

`k3s/secrets.yaml.example`
```yaml
# cp en secret réel (ne pas committer la version remplie) :
#   kubectl create secret generic iphr-app-secrets -n iphr --from-literal=FRED_API_KEY=xxxx
apiVersion: v1
kind: Secret
metadata:
  name: iphr-app-secrets
  namespace: iphr
type: Opaque
stringData:
  FRED_API_KEY: "REMPLACER"
```

- [ ] **Step 2: Valider le YAML de chaque manifest**

Run: `for f in k3s/*.yaml; do python3 -c "import yaml,sys; list(yaml.safe_load_all(open('$f'))); print('ok','$f')"; done`
Expected: `ok` pour les 5 fichiers.

- [ ] **Step 3: Commit**

```bash
git add k3s/
git commit -m "deploy: manifests k3s (ns, deploy, svc nodeport 30082, ingress tls)"
```

---

## Task 15: README + suite complète + dépôt distant

**Files:**
- Create: `README.md`

- [ ] **Step 1: Écrire `README.md`**

```markdown
# IPHR Dashboard

Dashboard macro/marchés « Régime IPHR — Inflation-Push Hawkish Repricing ». Service Node.js
qui agrège des indicateurs (pétrole, taux, anticipations d'inflation, stocks, salaires) depuis
FRED et Yahoo Finance, avec repli sur des valeurs configurables, et les affiche en thème sombre.

## Pour qui

Usage interne Gheop. En ligne sur https://iphr.gheop.com.

## Installation

```bash
npm install
cp .env.example .env   # renseigner FRED_API_KEY (clé gratuite : https://fredaccount.stlouisfed.org/apikeys)
npm start              # http://localhost:8080
```

Sans `FRED_API_KEY`, l'app démarre quand même sur les valeurs de repli.

## Tests

```bash
npm test
```

## Données

- Live : FRED (taux, breakevens, Michigan, 5Y5Y forward, Atlanta wage, stocks US) et Yahoo
  Finance (Brent, WTI, RBOB, Heating Oil pour le crack spread, MOVE).
- Repli config (`config/indicators.json`) : indicateurs sans source gratuite (ISM Prices Paid,
  OECD on-land, floating storage, backwardation, 5Y5Y swap, salaires UE) et bloc scénario.

## Déploiement

Push sur `master` → GitHub Actions build l'image `ghcr.io/gheop/iphr`, la pousse, puis
déploie par SSH sur le k3s (`kubectl set image`). Manifests dans `k3s/` (à appliquer une fois,
copiés dans `Gheop/k3s/iphr/`).

## Changelog

### v0.1.0 — Première version (2026-05-22)

- Dashboard IPHR : 5 sections d'indicateurs + bloc scénario spirale/pas de spirale + seuils
- Données live FRED + Yahoo, repli sur valeurs configurables
- Sparklines SVG, thème sombre, rafraîchissement client toutes les 60 s
- Déploiement k3s à iphr.gheop.com (Traefik + TLS Let's Encrypt)
```

- [ ] **Step 2: Lancer toute la suite de tests**

Run: `npm test 2>&1 | tail -5`
Expected: tous les tests passent (≈ 25 tests, 0 fail).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: readme et changelog v0.1.0"
```

- [ ] **Step 4: Créer le dépôt privé et pousser**

Run:
```bash
gh repo create Gheop/iphr --private --source=. --remote=origin --push
```
Expected: dépôt `Gheop/iphr` créé, branche poussée. (Le workflow se déclenchera ; il échouera au step Deploy tant que les manifests + secrets ne sont pas sur l'hôte — voir Task 16.)

---

## Task 16: Mise en service sur le cluster (manuel, hors push)

> Ces étapes nécessitent un accès réseau au cluster (API `gheop.com:6443` injoignable depuis la
> machine de dev). À exécuter par l'utilisateur depuis l'hôte k3s ou via SSH.

- [ ] **Step 1: DNS** — pointer `iphr.gheop.com` → `163.172.75.204` (A record), comme les autres sous-domaines.

- [ ] **Step 2: Copier les manifests dans le repo k3s**

```bash
# dans une copie de Gheop/k3s
mkdir -p iphr && cp <iphr>/k3s/*.yaml iphr/
git add iphr && git commit -m "add iphr manifests" && git push
```

- [ ] **Step 3: Appliquer sur le cluster (sur l'hôte)**

```bash
kubectl apply -f iphr/namespace.yaml
# secret app (clé FRED) :
kubectl create secret generic iphr-app-secrets -n iphr --from-literal=FRED_API_KEY=<clé>
# secret pull GHCR (réutiliser le même schéma que reader/meals) :
kubectl create secret docker-registry ghcr-pull-secret -n iphr \
  --docker-server=ghcr.io --docker-username=<gh-user> --docker-password=<gh-pat-read:packages>
kubectl apply -f iphr/deployment.yaml -f iphr/service.yaml -f iphr/ingress.yaml
kubectl rollout status deployment/iphr -n iphr --timeout=120s
```

- [ ] **Step 4: Vérifier**

```bash
curl -s https://iphr.gheop.com/healthz   # → ok
```
Expected: `ok`, puis la page accessible dans le navigateur. Le certificat Let's Encrypt est émis par Traefik au premier accès HTTPS.

---

## Self-Review

**Spec coverage :**
- En-tête, sections, cartes, badges → Tasks 6, 8. ✓
- Indicateurs live FRED/Yahoo + calculs (crack spread, conversions) → Tasks 3, 4, 5, 7. ✓
- Fallback config + bloc scénario + seuils → Tasks 6, 8. ✓
- Architecture (cache, scheduler, server, render, frontend) → Tasks 2, 8, 9, 10, 11. ✓
- Gestion d'erreurs (source KO → cache/stale, clé absente, /healthz) → Tasks 9, 10. ✓
- Tests (compute, cache, sources, render, scheduler) → Tasks 2-9. ✓
- Déploiement (Dockerfile, CI, manifests, actions manuelles) → Tasks 12, 13, 14, 16. ✓
- README + changelog → Task 15. ✓

**Type consistency :** `buildModel(config, fetched)`, `fetched[cardId] = {value, history}`, `card.badge = {text, tone}`, `sparklinePath(history, w, h)`, `renderHtml(model)` cohérents entre tasks.

**Placeholders :** la coquille volontaire `--tag: #5b6party;` est signalée et corrigée en Task 11 Step 1. Aucun TODO/TBD résiduel.

**Note d'implémentation à vérifier au runtime :** unités des séries FRED stocks (`WCESTUS1`/`WCSSTUS1`, en milliers de barils → `thousandsToMb`) et ID exact Atlanta Fed (`FRBATLWGT3MMAUMHWGO`). Si une série renvoie une valeur incohérente avec les captures, ajuster `transform`/`series` dans `config/indicators.json` sans changer le code.
