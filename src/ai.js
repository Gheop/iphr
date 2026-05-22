const TONES = new Set(['alert', 'warn', 'ok', 'neutral']);
const EDITORIAL_IDS = ['backwardation', 'swap5y5y', 'ismprices', 'oecd', 'floating', 'euwage'];

export function buildPrompt(model) {
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
    "« Inflation-Push Hawkish Repricing » : deux scénarios (spirale inflationniste vs pas de spirale)",
    "avec leur probabilité, des puces d'argumentaire, des seuils de bascule à surveiller, et un badge",
    "court pour quelques indicateurs sans source de marché.",
    '',
    'RÈGLES STRICTES :',
    "- N'invente AUCUNE valeur chiffrée d'indicateur : utilise uniquement les valeurs fournies.",
    '- Les deux probabilités doivent sommer à ~100 %.',
    `- editorialBadges : uniquement pour ces ids si pertinent : ${EDITORIAL_IDS.join(', ')}.`,
    '- tone ∈ alert | warn | ok | neutral. text = libellé court en MAJUSCULES (1-2 mots).',
    '- Réponds UNIQUEMENT par un objet JSON, sans texte autour, à ce format :',
    '{"scenario":{"spiral":{"probability":"≈ NN %","bullets":["…"]},',
    '"noSpiral":{"probability":"≈ NN %","bullets":["…"]},"thresholds":["…"]},',
    '"editorialBadges":{"<id>":{"text":"…","tone":"…"}}}',
  ].join('\n');
  const user = `Indicateurs du jour :\n\n${lines.join('\n')}`;
  return { system, user };
}

function cleanBadges(raw) {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const [id, b] of Object.entries(raw)) {
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
      spiral: { probability: sc.spiral.probability.trim(), bullets: sc.spiral.bullets },
      noSpiral: { probability: sc.noSpiral.probability.trim(), bullets: sc.noSpiral.bullets },
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
  } = deps;
  if (!apiKey) {
    log.info?.('[ai] ANTHROPIC_API_KEY absente — analyse IA désactivée');
    return null;
  }
  const { system, user } = buildPrompt(model);
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
