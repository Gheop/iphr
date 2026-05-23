const MAX_HISTORY = 12;

export function parseEia(json) {
  const data = json?.response?.data;
  if (!Array.isArray(data) || data.length === 0) return { value: null, history: [] };
  // Tri chronologique explicite par période (ne dépend pas de l'ordre renvoyé par l'API).
  const asc = [...data].sort((a, b) => String(a.period).localeCompare(String(b.period)));
  const nums = asc.map((d) => Number(d.value)).filter((n) => Number.isFinite(n));
  const history = nums.slice(-MAX_HISTORY);
  return { value: history.length ? history[history.length - 1] : null, history };
}

export async function fetchEiaSeries(route, seriesId, apiKey, fetchImpl = fetch, opts = {}) {
  // STEO utilise facets[seriesId] et frequency=monthly ; petroleum/stoc/wstk utilise
  // facets[series] et frequency=weekly. On garde les defauts STEO pour rétrocompat.
  const { facetKey = 'seriesId', frequency = 'monthly' } = opts;
  const url =
    `https://api.eia.gov/v2/${route}/data/` +
    `?api_key=${encodeURIComponent(apiKey)}` +
    `&frequency=${encodeURIComponent(frequency)}&data[]=value` +
    `&facets[${facetKey}][]=${encodeURIComponent(seriesId)}` +
    `&sort[0][column]=period&sort[0][direction]=desc&length=${MAX_HISTORY}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`EIA ${seriesId} HTTP ${res.status}`);
  return parseEia(await res.json());
}
