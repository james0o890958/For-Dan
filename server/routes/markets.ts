import { Router } from 'express';

const router = Router();

const BINANCE_DATA_BASE = 'https://data-api.binance.vision/api/v3';

const SUPPORTED_PAIRS: Record<string, string> = {
  'BTC/USDT': 'BTCUSDT',
  'ETH/USDT': 'ETHUSDT',
  'XRP/USDT': 'XRPUSDT',
  'LTC/USDT': 'LTCUSDT',
  'BCH/USDT': 'BCHUSDT',
  'TRX/USDT': 'TRXUSDT',
  'SOL/USDT': 'SOLUSDT',
};

const TIMEFRAME_TO_INTERVAL: Record<string, { interval: string; limit: number }> = {
  '15M': { interval: '15m', limit: 48 },
  '1H': { interval: '1h', limit: 48 },
  '4H': { interval: '4h', limit: 48 },
  '1D': { interval: '1d', limit: 45 },
  '1W': { interval: '1w', limit: 36 },
};

interface CacheEntry<T> {
  expiresAt: number;
  data: T;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCached<T>(key: string, data: T, ttlMs: number) {
  cache.set(key, { expiresAt: Date.now() + ttlMs, data });
}

function resolvePairSymbol(rawSymbol: string): { pairSymbol: string; venueSymbol: string } | null {
  const normalized = decodeURIComponent(rawSymbol).trim().toUpperCase();
  if (SUPPORTED_PAIRS[normalized]) {
    return { pairSymbol: normalized, venueSymbol: SUPPORTED_PAIRS[normalized] };
  }
  const byVenue = Object.entries(SUPPORTED_PAIRS).find(([, venue]) => venue === normalized);
  if (byVenue) {
    return { pairSymbol: byVenue[0], venueSymbol: byVenue[1] };
  }
  return null;
}

function formatCandleTimeLabel(openTimeMs: number, timeframe: string): string {
  const d = new Date(openTimeMs);
  if (timeframe === '1D' || timeframe === '1W') {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  if (timeframe === '4H') {
    return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${String(d.getUTCHours()).padStart(2, '0')}:00`;
  }
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 4500): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    throw new Error(`Market upstream returned HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

router.get('/tickers', async (_req, res) => {
  const cacheKey = 'tickers:all';
  const cached = getCached<{
    providerName: string;
    dataStatus: 'live';
    syncedAt: string;
    tickers: unknown[];
  }>(cacheKey);
  if (cached) {
    res.json({ ok: true, data: cached });
    return;
  }

  try {
    const venueList = Object.values(SUPPORTED_PAIRS);
    const symbolsParam = encodeURIComponent(JSON.stringify(venueList));
    const raw = await fetchJsonWithTimeout<
      Array<{
        symbol: string;
        lastPrice: string;
        priceChangePercent: string;
        highPrice: string;
        lowPrice: string;
        volume: string;
      }>
    >(`${BINANCE_DATA_BASE}/ticker/24hr?symbols=${symbolsParam}`);

    const byVenue = new Map(raw.map((item) => [item.symbol, item]));
    const nowIso = new Date().toISOString();

    const tickers = Object.entries(SUPPORTED_PAIRS).map(([pairSymbol, venueSymbol]) => {
      const item = byVenue.get(venueSymbol);
      return {
        symbol: pairSymbol,
        venueSymbol,
        price: item ? Number(item.lastPrice) : 0,
        change24hPct: item ? Number(item.priceChangePercent) : 0,
        high24h: item ? Number(item.highPrice) : 0,
        low24h: item ? Number(item.lowPrice) : 0,
        volume24h: item ? Number(item.volume) : 0,
        dataStatus: item && Number(item.lastPrice) > 0 ? 'live' : 'unavailable',
        updatedAt: nowIso,
      };
    });

    const payload = {
      providerName: 'Spot Market Feed',
      dataStatus: 'live' as const,
      syncedAt: nowIso,
      tickers,
    };
    setCached(cacheKey, payload, 4000);
    res.json({ ok: true, data: payload });
  } catch (err) {
    res.status(503).json({
      ok: false,
      code: 'MARKET_DATA_UNAVAILABLE',
      message: err instanceof Error ? err.message : 'Unable to fetch market tickers.',
    });
  }
});

router.get('/:symbol/candles', async (req, res) => {
  const resolved = resolvePairSymbol(req.params.symbol);
  if (!resolved) {
    res.status(404).json({ ok: false, code: 'UNKNOWN_PAIR', message: 'Unsupported trading pair.' });
    return;
  }

  const tfRaw = String(req.query.timeframe || '1H').trim().toUpperCase();
  const tfConfig = TIMEFRAME_TO_INTERVAL[tfRaw] ?? TIMEFRAME_TO_INTERVAL['1H'];
  const effectiveTf = TIMEFRAME_TO_INTERVAL[tfRaw] ? tfRaw : '1H';
  const cacheKey = `candles:${resolved.venueSymbol}:${effectiveTf}`;

  const cached = getCached<unknown[]>(cacheKey);
  if (cached) {
    res.json({
      ok: true,
      data: {
        symbol: resolved.pairSymbol,
        timeframe: effectiveTf,
        candles: cached,
      },
    });
    return;
  }

  try {
    const klines = await fetchJsonWithTimeout<Array<[number, string, string, string, string, string]>>(
      `${BINANCE_DATA_BASE}/klines?symbol=${resolved.venueSymbol}&interval=${tfConfig.interval}&limit=${tfConfig.limit}`
    );

    const candles = klines.map((k) => ({
      timestamp: k[0],
      timeLabel: formatCandleTimeLabel(k[0], effectiveTf),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    }));

    setCached(cacheKey, candles, 8000);
    res.json({
      ok: true,
      data: {
        symbol: resolved.pairSymbol,
        timeframe: effectiveTf,
        candles,
      },
    });
  } catch (err) {
    res.status(503).json({
      ok: false,
      code: 'CANDLES_UNAVAILABLE',
      message: err instanceof Error ? err.message : 'Unable to fetch candlestick data.',
    });
  }
});

router.get('/:symbol/orderbook', async (req, res) => {
  const resolved = resolvePairSymbol(req.params.symbol);
  if (!resolved) {
    res.status(404).json({ ok: false, code: 'UNKNOWN_PAIR', message: 'Unsupported trading pair.' });
    return;
  }

  const limitParam = Math.min(100, Math.max(5, Number(req.query.limit) || 50));
  const cacheKey = `orderbook:${resolved.venueSymbol}:${limitParam}`;
  const cached = getCached<unknown>(cacheKey);
  if (cached) {
    res.json({ ok: true, data: cached });
    return;
  }

  try {
    const depth = await fetchJsonWithTimeout<{
      lastUpdateId: number;
      bids: Array<[string, string]>;
      asks: Array<[string, string]>;
    }>(`${BINANCE_DATA_BASE}/depth?symbol=${resolved.venueSymbol}&limit=${limitParam}`);

    const bids = depth.bids.map(([p, q]) => [Number(p), Number(q)] as [number, number]);
    const asks = depth.asks.map(([p, q]) => [Number(p), Number(q)] as [number, number]);

    const payload = {
      symbol: resolved.pairSymbol,
      lastUpdateId: depth.lastUpdateId,
      bids,
      asks,
      updatedAt: new Date().toISOString(),
    };
    setCached(cacheKey, payload, 2500);
    res.json({ ok: true, data: payload });
  } catch (err) {
    res.status(503).json({
      ok: false,
      code: 'ORDERBOOK_UNAVAILABLE',
      message: err instanceof Error ? err.message : 'Unable to fetch order book depth.',
    });
  }
});

router.get('/:symbol/trades', async (req, res) => {
  const resolved = resolvePairSymbol(req.params.symbol);
  if (!resolved) {
    res.status(404).json({ ok: false, code: 'UNKNOWN_PAIR', message: 'Unsupported trading pair.' });
    return;
  }

  const limitParam = Math.min(50, Math.max(5, Number(req.query.limit) || 25));
  const cacheKey = `trades:${resolved.venueSymbol}:${limitParam}`;
  const cached = getCached<unknown>(cacheKey);
  if (cached) {
    res.json({ ok: true, data: cached });
    return;
  }

  try {
    const rawTrades = await fetchJsonWithTimeout<
      Array<{
        id: number;
        price: string;
        qty: string;
        quoteQty: string;
        time: number;
        isBuyerMaker: boolean;
      }>
    >(`${BINANCE_DATA_BASE}/trades?symbol=${resolved.venueSymbol}&limit=${limitParam}`);

    // Sort newest first; in Binance trades, isBuyerMaker=true means taker was seller
    const trades = rawTrades
      .slice()
      .sort((a, b) => b.time - a.time)
      .map((t) => ({
        id: String(t.id),
        symbol: resolved.pairSymbol,
        price: Number(t.price),
        quantity: Number(t.qty),
        quoteAmount: Number(t.quoteQty),
        side: t.isBuyerMaker ? ('sell' as const) : ('buy' as const),
        timestamp: new Date(t.time).toISOString(),
      }));

    const payload = {
      symbol: resolved.pairSymbol,
      trades,
      updatedAt: new Date().toISOString(),
    };
    setCached(cacheKey, payload, 2500);
    res.json({ ok: true, data: payload });
  } catch (err) {
    res.status(503).json({
      ok: false,
      code: 'TRADES_UNAVAILABLE',
      message: err instanceof Error ? err.message : 'Unable to fetch recent market trades.',
    });
  }
});

export default router;
