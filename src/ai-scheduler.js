import { readCache, writeCache } from './cache.js';
import { analyze } from './ai.js';

const AI_CACHE_PATH = process.env.AI_CACHE_PATH || 'data/ai-analysis.json';

export function shouldRefresh(cache, hours, nowMs) {
  if (!cache || !cache.generatedAt) return true;
  const age = nowMs - Date.parse(cache.generatedAt);
  return !(age >= 0 && age < hours * 3600 * 1000);
}

export async function runAi(getModel, deps = {}) {
  const {
    cachePath = AI_CACHE_PATH,
    hours = Number(process.env.AI_REFRESH_HOURS || 24),
    now = Date.now(),
    apiKey = process.env.ANTHROPIC_API_KEY,
    analyzeImpl = analyze,
    log = console,
  } = deps;

  const cache = readCache(cachePath);
  const hasCache = cache && cache.scenario;
  if (!apiKey) return hasCache ? cache : null;
  if (!shouldRefresh(cache, hours, now)) return hasCache ? cache : null;

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
  const hours = Number(deps.hours || process.env.AI_REFRESH_HOURS || 24);
  const cachePath = deps.cachePath || AI_CACHE_PATH;
  const existing = readCache(cachePath);
  if (existing && existing.scenario) onAnalysis(existing);
  const run = async () => {
    try {
      const a = await runAi(getModel, { ...deps, cachePath, hours, now: Date.now() });
      if (a) onAnalysis(a);
    } catch (err) {
      (deps.log || console).error?.(`[ai-scheduler] ${err.message}`);
    }
  };
  run();
  const timer = setInterval(run, hours * 3600 * 1000);
  timer.unref?.();
  return timer;
}
