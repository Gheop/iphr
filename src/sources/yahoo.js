const MAX_HISTORY = 60;

export function parseYahooChart(json) {
  const r = json?.chart?.result?.[0];
  if (!r) return { value: null, history: [] };
  const closes = (r.indicators?.quote?.[0]?.close || []).filter((n) => Number.isFinite(n));
  const history = closes.slice(-MAX_HISTORY);
  const last = history.length ? history[history.length - 1] : null;
  const value = Number.isFinite(r.meta?.regularMarketPrice) ? r.meta.regularMarketPrice : last;
  return { value, history };
}

export async function fetchYahooSymbol(symbol, fetchImpl = fetch) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=3mo&interval=1d`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0 iphr-dashboard' } });
  if (!res.ok) throw new Error(`Yahoo ${symbol} HTTP ${res.status}`);
  return parseYahooChart(await res.json());
}
