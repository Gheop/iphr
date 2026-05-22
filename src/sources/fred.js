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
