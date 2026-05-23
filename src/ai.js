const TONES = new Set(['alert', 'warn', 'ok', 'neutral']);
const EDITORIAL_IDS = ['backwardation', 'floating'];

const DEFAULT_LABELS = { spiral: 'Scénario spirale', noSpiral: 'Pas de spirale' };

export function nextFomcLabel(dates, nowMs) {
  if (!Array.isArray(dates)) return null;
  const today = new Date(nowMs);
  const startOfDay = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const next = dates
    .map((d) => Date.parse(d))
    .filter((t) => Number.isFinite(t) && t >= startOfDay)
    .sort((a, b) => a - b)[0];
  if (next === undefined) return null;
  return new Date(next).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function buildPrompt(model, extras = {}) {
  const lines = [];
  for (const section of model.sections) {
    lines.push(`## ${section.id} — ${section.title}`);
    for (const card of section.cards) {
      if (card.hidden) continue;
      lines.push(`- ${card.label} : ${card.displayValue}${card.context ? ` (${card.context})` : ''}`);
    }
  }
  const system = [
    "Tu es un analyste macro. À partir des indicateurs marché fournis, tu produis l'analyse du régime",
    "« Inflation-Push Hawkish Repricing » : deux scénarios (spirale inflationniste vs pas de spirale).",
    '',
    'RÈGLES STRICTES :',
    "- N'invente AUCUNE valeur chiffrée d'indicateur : utilise uniquement les valeurs fournies.",
    "- N'invente AUCUNE date : n'utilise que la date FOMC fournie ci-dessous, si présente.",
    '- Chaque scénario a un label court (ex. « Scénario spirale », « Pas de spirale », ou pertinent)',
    '  et une probabilité ; les deux probabilités somment à ~100 %.',
    '- bullets : COURTES, une ligne, format « sujet — constat » (ex. « Ménages en panique — Michigan 4,8 % »), 4-5 max.',
    '- thresholds : chips COURTS de 3-6 mots, surtout des déclencheurs chiffrés (ex. « HY OAS > 290 bps »,',
    '  « Atlanta wage > 4,5 % ↑ »). Tu peux inclure UN chip d\'événement daté avec la date FOMC fournie. 4-6 max.',
    `- editorialBadges : uniquement pour ces ids si pertinent : ${EDITORIAL_IDS.join(', ')}.`,
    '- tone ∈ alert | warn | ok | neutral. text = libellé court en MAJUSCULES (1-2 mots).',
    '- Réponds UNIQUEMENT par un objet JSON, sans texte autour, à ce format :',
    '{"scenario":{"spiral":{"label":"…","probability":"≈ NN %","bullets":["…"]},',
    '"noSpiral":{"label":"…","probability":"≈ NN %","bullets":["…"]},"thresholds":["…"]},',
    '"editorialBadges":{"<id>":{"text":"…","tone":"…"}}}',
  ].join('\n');
  const cal = extras.nextFomc ? `\n\nCalendrier : prochaine réunion FOMC le ${extras.nextFomc}.` : '';
  const user = `Indicateurs du jour :\n\n${lines.join('\n')}${cal}`;
  return { system, user };
}

function cleanBadges(raw) {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const [id, b] of Object.entries(raw)) {
      if (!EDITORIAL_IDS.includes(id)) continue;
      if (b && typeof b.text === 'string' && b.text.trim() && TONES.has(b.tone)) {
        out[id] = { text: b.text.trim(), tone: b.tone };
      }
    }
  }
  return out;
}

function validScenarioSide(s) {
  return s && typeof s.probability === 'string' && s.probability.trim() &&
    Array.isArray(s.bullets) && s.bullets.length > 0 &&
    s.bullets.every((b) => typeof b === 'string' && b.trim());
}

export function parseAnalysis(text) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let obj;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const sc = obj.scenario;
  if (!sc || !validScenarioSide(sc.spiral) || !validScenarioSide(sc.noSpiral)) return null;
  if (!Array.isArray(sc.thresholds) || sc.thresholds.length === 0 ||
      !sc.thresholds.every((t) => typeof t === 'string' && t.trim())) return null;
  return {
    scenario: {
      spiral: {
        label: (typeof sc.spiral.label === 'string' && sc.spiral.label.trim()) || DEFAULT_LABELS.spiral,
        probability: sc.spiral.probability.trim(),
        bullets: sc.spiral.bullets,
      },
      noSpiral: {
        label: (typeof sc.noSpiral.label === 'string' && sc.noSpiral.label.trim()) || DEFAULT_LABELS.noSpiral,
        probability: sc.noSpiral.probability.trim(),
        bullets: sc.noSpiral.bullets,
      },
      thresholds: sc.thresholds,
    },
    editorialBadges: cleanBadges(obj.editorialBadges),
  };
}

export async function analyze(model, deps = {}) {
  const {
    apiKey = process.env.ANTHROPIC_API_KEY,
    aiModel = process.env.AI_MODEL || 'claude-sonnet-4-6',
    fetchImpl = fetch,
    maxTokens = 1500,
    log = console,
    extras = {},
  } = deps;
  if (!apiKey) {
    log.info?.('[ai] ANTHROPIC_API_KEY absente — analyse IA désactivée');
    return null;
  }
  const { system, user } = buildPrompt(model, extras);
  try {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: aiModel,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) {
      log.warn?.(`[ai] HTTP ${res.status} — analyse conservée`);
      return null;
    }
    const json = await res.json();
    const text = json?.content?.[0]?.text;
    return parseAnalysis(text);
  } catch (err) {
    log.warn?.(`[ai] ${err.message} — analyse conservée`);
    return null;
  }
}
