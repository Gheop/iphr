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
    if (card.transform === 'bpsFromPct') {
      value = value * 100;
      history = history.map((h) => h * 100);
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
