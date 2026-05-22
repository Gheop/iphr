const MAX_HISTORY = 12;

export function parseEcbSdmx(json) {
  const series = json?.dataSets?.[0]?.series;
  const first = series && Object.values(series)[0];
  const obs = first?.observations;
  if (!obs) return { value: null, history: [] };
  const nums = Object.keys(obs)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => Number(obs[k][0]))
    .filter((n) => Number.isFinite(n));
  const history = nums.slice(-MAX_HISTORY);
  return { value: history.length ? history[history.length - 1] : null, history };
}

export async function fetchEcbSeries(flow, key, fetchImpl = fetch) {
  const url =
    `https://data-api.ecb.europa.eu/service/data/${flow}/${key}` +
    `?lastNObservations=${MAX_HISTORY}&format=jsondata`;
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`ECB ${flow}/${key} HTTP ${res.status}`);
  return parseEcbSdmx(await res.json());
}
