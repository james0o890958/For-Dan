import React, { useState } from 'react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { MarketFeedLabel } from '../../components/ui/CommonPrimitives';
import { useAppState } from '../../context/AppStateContext';
import type { MarketDataStatus } from '../../types/domain';
import { formatCryptoPrice } from '../../utils/tradingMath';

export const AdminAssetsPage: React.FC = () => {
  const { assets, updateAsset } = useAppState();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', isEnabled: true });
  const [msg, setMsg] = useState<string | null>(null);

  const startEdit = (id: string) => {
    const a = assets.find((x) => x.id === id);
    if (!a) return;
    setEditingId(id);
    setForm({ name: a.name, description: a.description, isEnabled: a.isEnabled });
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    const res = updateAsset(editingId, form);
    setMsg(res.message);
    if (res.ok) setEditingId(null);
  };

  return (
    <AdminLayout title="Asset Management">
      <div className="space-y-5">
        {msg && <p className="text-xs font-medium text-[#10C478]">{msg}</p>}

        <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="bg-[#E8EAEE] dark:bg-[#262629] text-left text-xs text-[#686D76] dark:text-[#7E828A]">
                  <th className="py-3 px-4 font-medium">Symbol</th>
                  <th className="py-3 px-4 font-medium">Name</th>
                  <th className="py-3 px-4 font-medium">Decimals</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                {assets.map((a) => (
                  <tr key={a.id}>
                    <td className="py-3 px-4 font-bold">{a.symbol}</td>
                    <td className="py-3 px-4">
                      <p className="font-medium">{a.name}</p>
                      <p className="text-[11px] text-[#686D76] dark:text-[#7E828A] line-clamp-1">
                        {a.description}
                      </p>
                    </td>
                    <td className="py-3 px-4 font-mono-num">{a.decimals}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-xs font-semibold ${
                          a.isEnabled ? 'text-[#10C478]' : 'text-[#F0525E]'
                        }`}
                      >
                        {a.isEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => {
                          const res = updateAsset(a.id, {
                            name: a.name,
                            description: a.description,
                            isEnabled: !a.isEnabled,
                          });
                          setMsg(res.message);
                        }}
                        className="px-3 py-1.5 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-xs font-medium"
                      >
                        {a.isEnabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(a.id)}
                        className="px-3 py-1.5 rounded-full bg-[#004AE2] text-white text-xs font-medium"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {editingId && (
          <form
            onSubmit={handleSave}
            className="max-w-xl rounded-2xl bg-white dark:bg-[#141518] border border-[#004AE2] p-5 space-y-4"
          >
            <h2 className="text-sm font-semibold">Edit Asset Details</h2>
            <div>
              <label htmlFor="asset-name" className="block text-xs font-medium mb-1">
                Asset Name
              </label>
              <input
                id="asset-name"
                type="text"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className="w-full h-10 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm"
              />
            </div>
            <div>
              <label htmlFor="asset-desc" className="block text-xs font-medium mb-1">
                Description
              </label>
              <textarea
                id="asset-desc"
                rows={2}
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                className="w-full p-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-xs"
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                className="px-5 h-10 rounded-full bg-[#004AE2] text-white text-xs font-semibold"
              >
                Save Asset
              </button>
              <button
                type="button"
                onClick={() => setEditingId(null)}
                className="px-5 h-10 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-xs font-medium"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </AdminLayout>
  );
};

export const AdminPairsPage: React.FC = () => {
  const { tradingPairs, updateTradingPair } = useAppState();
  const [feeInputs, setFeeInputs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <AdminLayout title="Trading Pair Management">
      <div className="space-y-4">
        {msg && (
          <p className={`text-xs font-medium ${msg.ok ? 'text-[#10C478]' : 'text-[#F0525E]'}`}>
            {msg.text}
          </p>
        )}

        <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="bg-[#E8EAEE] dark:bg-[#262629] text-left text-xs text-[#686D76] dark:text-[#7E828A]">
                  <th className="py-3 px-4 font-medium">Pair</th>
                  <th className="py-3 px-4 font-medium">Venue Symbol</th>
                  <th className="py-3 px-4 font-medium">Fee Rate (%)</th>
                  <th className="py-3 px-4 font-medium">Min Order (USDT)</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                {tradingPairs.map((pair) => {
                  const pctStr = feeInputs[pair.id] ?? (pair.feeRate * 100).toFixed(2);
                  return (
                    <tr key={pair.id}>
                      <td className="py-3 px-4 font-bold">{pair.symbol}</td>
                      <td className="py-3 px-4 font-mono-num text-xs">{pair.venueSymbol}</td>
                      <td className="py-3 px-4">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="5"
                          aria-label={`${pair.symbol} fee percentage`}
                          value={pctStr}
                          onChange={(e) =>
                            setFeeInputs((prev) => ({ ...prev, [pair.id]: e.target.value }))
                          }
                          className="w-24 h-9 px-2.5 rounded-lg bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-xs"
                        />
                      </td>
                      <td className="py-3 px-4 font-mono-num">{pair.minOrderUsdt} USDT</td>
                      <td className="py-3 px-4">
                        <span
                          className={`text-xs font-semibold ${
                            pair.isEnabled ? 'text-[#10C478]' : 'text-[#F0525E]'
                          }`}
                        >
                          {pair.isEnabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            const nextRate = Number(pctStr) / 100;
                            const res = updateTradingPair(pair.id, {
                              isEnabled: pair.isEnabled,
                              feeRate: nextRate,
                              minOrderUsdt: pair.minOrderUsdt,
                            });
                            setMsg({ ok: res.ok, text: res.message });
                          }}
                          className="px-3 py-1.5 rounded-full bg-[#004AE2] text-white text-xs font-medium"
                        >
                          Save Fee
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const res = updateTradingPair(pair.id, {
                              isEnabled: !pair.isEnabled,
                              feeRate: pair.feeRate,
                              minOrderUsdt: pair.minOrderUsdt,
                            });
                            setMsg({ ok: res.ok, text: res.message });
                          }}
                          className="px-3 py-1.5 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-xs font-medium"
                        >
                          {pair.isEnabled ? 'Disable' : 'Enable'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
};

export const AdminMarketSettingsPage: React.FC = () => {
  const { marketSettings, marketPrices, updateMarketSettings } = useAppState();

  const [status, setStatus] = useState<MarketDataStatus>(marketSettings.providerStatus);
  const [interval, setIntervalVal] = useState<number>(marketSettings.refreshIntervalSeconds);
  const [msg, setMsg] = useState<string | null>(null);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const res = updateMarketSettings({
      providerStatus: status,
      refreshIntervalSeconds: interval,
    });
    setMsg(res.message);
  };

  return (
    <AdminLayout title="Market Data Settings">
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <form
            onSubmit={handleSave}
            className="lg:col-span-5 rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Market Feed Configuration</h2>
              <MarketFeedLabel status={marketSettings.providerStatus} />
            </div>

            <div className="text-xs text-[#686D76] dark:text-[#7E828A] space-y-1">
              <p>Provider: {marketSettings.providerName}</p>
              <p className="font-mono-num">
                Last Checked: {new Date(marketSettings.lastSyncedAt).toLocaleString()}
              </p>
            </div>

            <div>
              <label htmlFor="mkt-status" className="block text-xs font-medium mb-1.5">
                Feed Status Mode
              </label>
              <select
                id="mkt-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as MarketDataStatus)}
                className="w-full h-11 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm"
              >
                <option value="unavailable">Unavailable (Phase C Feed Offline)</option>
                <option value="delayed">Delayed Feed (Requires Connected Provider)</option>
                <option value="live">Live Feed (Requires Connected Provider)</option>
              </select>
            </div>

            <div>
              <label htmlFor="mkt-refresh" className="block text-xs font-medium mb-1.5">
                Refresh Interval (Seconds)
              </label>
              <input
                id="mkt-refresh"
                type="number"
                min="1"
                max="300"
                value={interval}
                onChange={(e) => setIntervalVal(Number(e.target.value))}
                className="w-full h-11 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-sm"
              />
            </div>

            {msg && <p className="text-xs font-medium text-[#10C478]">{msg}</p>}

            <button
              type="submit"
              className="px-5 h-10 rounded-full bg-[#004AE2] text-white text-xs font-semibold"
            >
              Apply Feed Settings
            </button>
          </form>

          <div className="lg:col-span-7 rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E2E4E9] dark:border-[#22242A]">
              <h2 className="text-sm font-semibold">Market Feed Symbols</h2>
            </div>
            <div className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
              {marketPrices.map((m) => (
                <div key={m.symbol} className="px-4 py-3 flex items-center justify-between text-xs">
                  <div>
                    <p className="font-bold">{m.symbol}</p>
                    <p className="text-[11px] text-[#686D76] dark:text-[#7E828A] capitalize">
                      Status: {m.dataStatus}
                    </p>
                  </div>
                  <div className="text-right font-mono-num">
                    <p className="font-semibold">
                      {m.price > 0 ? `${formatCryptoPrice(m.price)} USDT` : 'Feed Offline'}
                    </p>
                    <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                      Vol {m.price > 0 ? m.volume24h.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
};
