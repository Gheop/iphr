import { readCache, writeCache } from './cache.js';
import { analyze } from './ai.js';

const AI_CACHE_PATH = process.env.AI_CACHE_PATH || 'data/ai-analysis.json';

export function shouldRefresh(cache, hours, nowMs) {
  if (!cache || !cache.generatedAt) return true;
  const age = nowMs - Date.parse(cache.generatedAt);
  return !(age >= 0 && age < hours * 3600 * 1000);
}

// Composantes calendaires d'un instant exprimé en heure de Paris.
function parisParts(instantMs) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const o = {};
  for (const p of parts) o[p.type] = p.value;
  return o;
}

// Décalage UTC→Paris (ms) à un instant donné, gère l'heure d'été/hiver.
function parisOffsetMs(instantMs) {
  const o = parisParts(instantMs);
  const wallAsUtc = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute, +o.second);
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

// Prochain instant (ms epoch) où il est HH:MM en heure de Paris, strictement après nowMs.
// DST-aware : 05:30 reste 05:30 toute l'année. (05:30 n'est jamais dans la zone de bascule DST.)
export function nextDailyRunMs(hour, minute, nowMs) {
  for (let addDays = 0; addDays < 3; addDays++) {
    const d = parisParts(nowMs + addDays * 86400000);
    const wall = Date.UTC(+d.year, +d.month - 1, +d.day, hour, minute, 0);
    const t = wall - parisOffsetMs(wall);
    if (t > nowMs) return t;
  }
  return nowMs + 86400000;
}

export async function runAi(getModel, deps = {}) {
  const {
    cachePath = AI_CACHE_PATH,
    hours = Number(process.env.AI_REFRESH_HOURS || 24),
    now = Date.now(),
    apiKey = process.env.ANTHROPIC_API_KEY,
    analyzeImpl = analyze,
    force = false,
    log = console,
  } = deps;

  const cache = readCache(cachePath);
  const hasCache = cache && cache.scenario;
  if (!apiKey) return hasCache ? cache : null;
  if (!force && !shouldRefresh(cache, hours, now)) return hasCache ? cache : null;

  const analysis = await analyzeImpl(getModel(), { apiKey, log });
  if (!analysis) {
    log.warn?.('[ai-scheduler] analyse vide — cache conservé');
    return hasCache ? cache : null;
  }
  const out = { generatedAt: new Date(now).toISOString(), ...analysis };
  writeCache(cachePath, out);
  return out;
}

export function startAi(getModel, onAnalysis, deps = {}) {
  const cachePath = deps.cachePath || AI_CACHE_PATH;
  const hour = deps.hour ?? Number(process.env.AI_HOUR ?? 5);
  const minute = deps.minute ?? Number(process.env.AI_MINUTE ?? 30);
  const log = deps.log || console;

  const existing = readCache(cachePath);
  if (existing && existing.scenario) onAnalysis(existing);

  // Au démarrage : régénère si l'analyse en cache est périmée (un déploiement donne du frais).
  runAi(getModel, { ...deps, cachePath, now: Date.now() })
    .then((a) => { if (a) onAnalysis(a); })
    .catch((err) => log.error?.(`[ai-scheduler] ${err.message}`));

  // Régénération forcée chaque jour à HH:MM heure de Paris.
  const scheduleNext = () => {
    const delay = Math.max(0, nextDailyRunMs(hour, minute, Date.now()) - Date.now());
    const timer = setTimeout(async () => {
      try {
        const a = await runAi(getModel, { ...deps, cachePath, now: Date.now(), force: true });
        if (a) onAnalysis(a);
      } catch (err) {
        log.error?.(`[ai-scheduler] ${err.message}`);
      }
      scheduleNext();
    }, delay);
    timer.unref?.();
  };
  scheduleNext();
}
