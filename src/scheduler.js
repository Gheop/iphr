import { readCache, writeCache } from './cache.js';
import { fetchFredSeries } from './sources/fred.js';
import { fetchYahooSymbol } from './sources/yahoo.js';
import { fetchEcbSeries } from './sources/ecb.js';
import { fetchEiaSeries } from './sources/eia.js';

const CACHE_PATH = process.env.CACHE_PATH || 'data/cache.json';

export async function refresh(config, deps = {}) {
  const {
    fredKey = process.env.FRED_API_KEY,
    fetchFred = fetchFredSeries,
    fetchYahoo = fetchYahooSymbol,
    eiaKey = process.env.EIA_API_KEY,
    fetchEcb = fetchEcbSeries,
    fetchEia = fetchEiaSeries,
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
        } else if (src.type === 'ecb') {
          fetched[card.id] = await fetchEcb(src.flow, src.key);
        } else if (src.type === 'eia') {
          if (!eiaKey) throw new Error('EIA_API_KEY manquante');
          fetched[card.id] = await fetchEia(src.route, src.seriesId, eiaKey);
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
