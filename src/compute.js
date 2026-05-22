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
  // 1. crack spread calculé (valeur + historique zippé depuis les inputs)
  if (card.compute === 'crackSpread321') {
    const { cl, rb, ho } = card.inputs;
    const f = fetched;
    if (f[cl]?.value != null && f[rb]?.value != null && f[ho]?.value != null) {
      const value = crackSpread321(f[cl].value, f[rb].value, f[ho].value);
      const hc = f[cl].history || [], hr = f[rb].history || [], hh = f[ho].history || [];
      const n = Math.min(hc.length, hr.length, hh.length);
      const history = [];
      for (let i = 0; i < n; i++) {
        history.push(crackSpread321(hc[hc.length - n + i], hr[hr.length - n + i], hh[hh.length - n + i]));
      }
      return { value, history, stale: false };
    }
    const fb = card.fallback ?? {};
    return { value: fb.value ?? null, history: fb.history ?? [], stale: true };
  }
  // 1b. moyenne d'inputs (ex. ISM proxy = moyenne d'indices Fed régionaux)
  if (card.compute === 'average') {
    const ids = card.inputs || [];
    const vals = ids.map((id) => fetched[id]?.value).filter((v) => Number.isFinite(v));
    if (vals.length) {
      const value = vals.reduce((a, b) => a + b, 0) / vals.length;
      const hists = ids.map((id) => fetched[id]?.history || []).filter((h) => h.length);
      let history = [];
      if (hists.length) {
        const n = Math.min(...hists.map((h) => h.length));
        for (let i = 0; i < n; i++) {
          const slice = hists.map((h) => h[h.length - n + i]);
          history.push(slice.reduce((a, b) => a + b, 0) / slice.length);
        }
      }
      return { value, history, stale: false };
    }
    const fb = card.fallback ?? {};
    return { value: fb.value ?? null, history: fb.history ?? [], stale: true };
  }
  // 2. source live (fred/yahoo)
  const live = fetched[card.id];
  if (live && Number.isFinite(live.value)) {
    let value = live.value;
    let history = live.history || [];
    if (card.transform === 'thousandsToMb') {
      value = thousandsToMb(value);
      history = history.map(thousandsToMb);
    }
    if (card.transform === 'bpsFromPct') {
      value = value * 100;
      history = history.map((h) => h * 100);
    }
    return { value, history, stale: false };
  }
  // 3. fallback config
  const fb = card.fallback ?? {};
  return { value: fb.value ?? null, history: fb.history ?? [], stale: true };
}

export function buildModel(config, fetched, aiAnalysis = null) {
  const sections = config.sections.map((section) => ({
    id: section.id,
    title: section.title,
    cards: section.cards.map((card) => {
      const { value, history, stale } = resolveCard(card, fetched);
      let badge = evaluateBadge(value, card.rules, card.badge);
      const aiBadge = aiAnalysis && aiAnalysis.editorialBadges && aiAnalysis.editorialBadges[card.id];
      if (aiBadge) badge = aiBadge;
      return {
        id: card.id,
        hidden: !!card.hidden,
        label: card.label,
        sourceTag: card.sourceTag || '',
        prefix: card.prefix || '',
        suffix: card.suffix || '',
        decimals: card.decimals ?? 0,
        value,
        displayValue: formatValue(value, card),
        context: card.context || '',
        badge,
        history,
        stale,
      };
    }),
  }));
  return {
    meta: { ...config.meta, refreshedAt: new Date().toISOString() },
    sections,
    scenario: (aiAnalysis && aiAnalysis.scenario) || config.scenario,
  };
}
