import React, { useMemo, useState } from 'react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { DepositStatusLabel, EmptyState } from '../../components/ui/CommonPrimitives';
import { useAppState } from '../../context/AppStateContext';
import { canApproveDeposit } from '../../utils/exchangeEngine';
import { formatQty } from '../../utils/tradingMath';

export const AdminDepositsPage: React.FC = () => {
  const {
    deposits,
    networks,
    ledgerTransactions,
    profiles,
    depositAddresses,
    receivingAddresses,
    manualPurchaseOrders,
    confirmDepositFinality,
    reviewDeposit,
    updateNetworkConfig,
    assignDepositAddress,
    saveReceivingAddress,
    toggleReceivingAddressStatus,
  } = useAppState();

  const [tab, setTab] = useState<'queue' | 'networks' | 'addresses'>('queue');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const [addrCustomerUserId, setAddrCustomerUserId] = useState(profiles[0]?.id ?? '');
  const [addrAsset, setAddrAsset] = useState('USDT');
  const addrNetworks = useMemo(() => networks.filter((n) => n.assetSymbol === addrAsset), [networks, addrAsset]);
  const [addrNetworkCode, setAddrNetworkCode] = useState(addrNetworks[0]?.code ?? 'TRC-20');
  const [addrValue, setAddrValue] = useState('');
  const [addrMemo, setAddrMemo] = useState('');

  const [recAsset, setRecAsset] = useState('USDT');
  const recNetworks = useMemo(
    () => networks.filter((n) => n.assetSymbol === recAsset),
    [networks, recAsset]
  );
  const [recNetworkCode, setRecNetworkCode] = useState('TRC-20');
  const [recLabel, setRecLabel] = useState('');
  const [recAddress, setRecAddress] = useState('');
  const [recMemo, setRecMemo] = useState('');

  const [editingNetId, setEditingNetId] = useState<string | null>(null);
  const [netForm, setNetForm] = useState({
    requiredConfirmations: 12,
    minDeposit: 10,
    minWithdrawal: 20,
    networkFee: 1,
    platformFee: 0,
    isDepositEnabled: true,
    isWithdrawalEnabled: true,
  });

  const profileMap = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  const activeQueue = useMemo(
    () => deposits.filter((d) => d.status !== 'CREDITED' && d.status !== 'REJECTED'),
    [deposits]
  );

  const settledDeposits = useMemo(
    () => deposits.filter((d) => d.status === 'CREDITED' || d.status === 'REJECTED'),
    [deposits]
  );

  const startEditNetwork = (id: string) => {
    const found = networks.find((n) => n.id === id);
    if (!found) return;
    setEditingNetId(id);
    setNetForm({
      requiredConfirmations: found.requiredConfirmations,
      minDeposit: found.minDeposit,
      minWithdrawal: found.minWithdrawal,
      networkFee: found.networkFee,
      platformFee: found.platformFee,
      isDepositEnabled: found.isDepositEnabled,
      isWithdrawalEnabled: found.isWithdrawalEnabled,
    });
  };

  const handleSaveNetwork = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingNetId) return;
    const res = updateNetworkConfig(editingNetId, netForm);
    setFeedback({ ok: res.ok, text: res.message });
    if (res.ok) setEditingNetId(null);
  };

  const handleAssignAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await assignDepositAddress({
      userId: addrCustomerUserId,
      assetSymbol: addrAsset,
      networkCode: addrNetworkCode,
      address: addrValue,
      memoOrTag: addrMemo,
    });
    setFeedback({ ok: res.ok, text: res.message });
    if (res.ok) {
      setAddrValue('');
      setAddrMemo('');
    }
  };

  const handleSaveReceivingAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await saveReceivingAddress({
      assetSymbol: recAsset,
      networkCode: recNetworkCode,
      label: recLabel,
      address: recAddress,
      memoOrTag: recMemo,
      isActive: true,
    });
    setFeedback({ ok: res.ok, text: res.message });
    if (res.ok) {
      setRecLabel('');
      setRecAddress('');
      setRecMemo('');
    }
  };

  return (
    <AdminLayout title="Deposit Verification & Network Rules">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTab('queue')}
              className={`px-4 py-2 rounded-full text-xs font-semibold ${
                tab === 'queue'
                  ? 'bg-[#004AE2] text-white'
                  : 'bg-[#E8EAEE] dark:bg-[#242528] text-[#686D76] dark:text-[#9CA0A8]'
              }`}
            >
              Blockchain Verification Queue ({activeQueue.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('networks')}
              className={`px-4 py-2 rounded-full text-xs font-semibold ${
                tab === 'networks'
                  ? 'bg-[#004AE2] text-white'
                  : 'bg-[#E8EAEE] dark:bg-[#242528] text-[#686D76] dark:text-[#9CA0A8]'
              }`}
            >
              Network Rules & Confirmations
            </button>
            <button
              type="button"
              onClick={() => setTab('addresses')}
              className={`px-4 py-2 rounded-full text-xs font-semibold ${
                tab === 'addresses'
                  ? 'bg-[#004AE2] text-white'
                  : 'bg-[#E8EAEE] dark:bg-[#242528] text-[#686D76] dark:text-[#9CA0A8]'
              }`}
            >
              Deposit &amp; Receiving Addresses ({depositAddresses.length + receivingAddresses.length})
            </button>
          </div>

          {feedback && (
            <p
              role="status"
              className={`text-xs font-medium ${feedback.ok ? 'text-[#10C478]' : 'text-[#F0525E]'}`}
            >
              {feedback.text}
            </p>
          )}
        </div>

        {tab === 'queue' && (
          <div className="space-y-6">
            <div className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 text-xs text-[#686D76] dark:text-[#7E828A]">
              Strict verification policy: Deposits can only be approved and credited once after transaction hash detection, destination address matching, network &amp; amount verification, confirmation finality, duplicate check, and KYT screening all pass.
            </div>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold">Detected &amp; Pending Review Deposits</h2>
              {activeQueue.length === 0 ? (
                <EmptyState
                  title="No pending on-chain deposits"
                  description="Inbound deposits detected by the blockchain indexer / custody webhooks (Phase C/D) appear here for verification review."
                />
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {activeQueue.map((dep) => {
                    const customer = profileMap.get(dep.userId);
                    const gate = canApproveDeposit(dep, deposits, ledgerTransactions, {
                      customerAccountStatus: customer?.accountStatus,
                      existingManualPurchaseOrders: manualPurchaseOrders,
                    });
                    return (
                      <div
                        key={dep.id}
                        className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold">{customer?.fullName ?? 'Customer'}</p>
                            <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                              {customer?.email} ·{' '}
                              <span className="font-mono-num">ID {customer?.publicUserId}</span>
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-base font-bold font-mono-num text-[#004AE2] dark:text-[#60A5FA]">
                              {formatQty(dep.amount)} {dep.assetSymbol}
                            </p>
                            <DepositStatusLabel status={dep.status} />
                          </div>
                        </div>

                        <dl className="grid grid-cols-2 gap-3 text-xs rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] p-3">
                          <div>
                            <dt className="text-[#686D76] dark:text-[#7E828A]">Network</dt>
                            <dd className="font-medium mt-0.5">{dep.networkCode}</dd>
                          </div>
                          <div>
                            <dt className="text-[#686D76] dark:text-[#7E828A]">Confirmations</dt>
                            <dd className="font-mono-num font-semibold mt-0.5">
                              {dep.confirmations} / {dep.requiredConfirmations}
                            </dd>
                          </div>
                          <div className="col-span-2">
                            <dt className="text-[#686D76] dark:text-[#7E828A]">Transaction Hash</dt>
                            <dd className="font-mono-num break-all mt-0.5">{dep.txHash}</dd>
                          </div>
                          <div>
                            <dt className="text-[#686D76] dark:text-[#7E828A]">Checks</dt>
                            <dd className="mt-0.5">
                              Addr: {dep.addressVerified ? 'Pass' : 'Fail'} · Net:{' '}
                              {dep.networkVerified ? 'Pass' : 'Fail'} · Amt:{' '}
                              {dep.amountVerified ? 'Pass' : 'Fail'} · Dup:{' '}
                              {dep.duplicateChecked ? 'Clear' : 'Pending'}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[#686D76] dark:text-[#7E828A]">KYT Screening</dt>
                            <dd className="capitalize font-semibold mt-0.5">
                              {dep.kytStatus}
                              {dep.kytRiskScore !== null ? ` (Risk ${dep.kytRiskScore})` : ''}
                            </dd>
                          </div>
                        </dl>

                        {!gate.allowed && gate.reason && (
                          <p className="text-xs text-[#D97706] font-medium">{gate.reason}</p>
                        )}

                        <div>
                          <label htmlFor={`dep-note-${dep.id}`} className="block text-xs font-medium mb-1">
                            Verification Note
                          </label>
                          <input
                            id={`dep-note-${dep.id}`}
                            type="text"
                            value={notes[dep.id] ?? ''}
                            onChange={(e) =>
                              setNotes((prev) => ({ ...prev, [dep.id]: e.target.value }))
                            }
                            placeholder="Review or rejection reason"
                            className="w-full h-10 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-xs"
                          />
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          {dep.confirmations < dep.requiredConfirmations && (
                            <button
                              type="button"
                              onClick={async () => {
                                const res = await confirmDepositFinality(dep.id);
                                setFeedback({ ok: res.ok, text: res.message });
                              }}
                              className="h-10 px-4 rounded-full bg-[#004AE2] text-white text-xs font-semibold hover:opacity-95"
                            >
                              Verify Block Finality ({dep.requiredConfirmations}/{dep.requiredConfirmations})
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={!gate.allowed}
                            onClick={async () => {
                              const res = await reviewDeposit(dep.id, 'approved', notes[dep.id] ?? '');
                              setFeedback({ ok: res.ok, text: res.message });
                            }}
                            className="flex-1 h-10 rounded-full bg-[#10C478] text-white text-xs font-semibold hover:opacity-95 disabled:opacity-45 disabled:cursor-not-allowed"
                          >
                            Approve &amp; Credit Once
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const res = await reviewDeposit(dep.id, 'rejected', notes[dep.id] ?? '');
                              setFeedback({ ok: res.ok, text: res.message });
                            }}
                            className="flex-1 h-10 rounded-full bg-[#F0525E] text-white text-xs font-semibold hover:opacity-95"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#E2E4E9] dark:border-[#22242A]">
                <h2 className="text-sm font-semibold">Settled &amp; Rejected Deposits</h2>
              </div>
              {settledDeposits.length === 0 ? (
                <p className="p-5 text-xs text-[#686D76] dark:text-[#7E828A]">
                  No credited or rejected blockchain deposits recorded yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs sm:text-sm">
                    <thead>
                      <tr className="bg-[#E8EAEE] dark:bg-[#262629] text-left text-xs text-[#686D76] dark:text-[#7E828A]">
                        <th className="py-3 px-4 font-medium">Customer</th>
                        <th className="py-3 px-4 font-medium">Network</th>
                        <th className="py-3 px-4 font-medium">Tx Hash</th>
                        <th className="py-3 px-4 font-medium text-right">Amount</th>
                        <th className="py-3 px-4 font-medium">Status</th>
                        <th className="py-3 px-4 font-medium">Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                      {settledDeposits.map((d) => {
                        const customer = profileMap.get(d.userId);
                        return (
                          <tr key={d.id}>
                            <td className="py-3 px-4">
                              <p className="font-semibold">{customer?.fullName}</p>
                              <p className="text-[11px] font-mono-num text-[#686D76] dark:text-[#7E828A]">
                                ID {customer?.publicUserId}
                              </p>
                            </td>
                            <td className="py-3 px-4 text-xs">
                              {d.assetSymbol} ({d.networkCode})
                            </td>
                            <td className="py-3 px-4 font-mono-num text-xs truncate max-w-[160px]">
                              {d.txHash}
                            </td>
                            <td className="py-3 px-4 text-right font-mono-num font-semibold">
                              {formatQty(d.amount)}
                            </td>
                            <td className="py-3 px-4">
                              <DepositStatusLabel status={d.status} />
                            </td>
                            <td className="py-3 px-4 text-xs text-[#686D76] dark:text-[#7E828A]">
                              {d.adminNote || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {tab === 'networks' && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="bg-[#E8EAEE] dark:bg-[#262629] text-left text-xs text-[#686D76] dark:text-[#7E828A]">
                      <th className="py-3 px-4 font-medium">Asset / Network</th>
                      <th className="py-3 px-4 font-medium text-right">Confirmations</th>
                      <th className="py-3 px-4 font-medium text-right">Min Deposit</th>
                      <th className="py-3 px-4 font-medium text-right">Min Withdraw</th>
                      <th className="py-3 px-4 font-medium text-right">Fees (Net / Plat)</th>
                      <th className="py-3 px-4 font-medium">Channels</th>
                      <th className="py-3 px-4 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23] font-mono-num">
                    {networks.map((n) => (
                      <tr key={n.id}>
                        <td className="py-3 px-4 font-sans">
                          <p className="font-semibold">
                            {n.assetSymbol} · {n.code}
                          </p>
                          <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">{n.name}</p>
                        </td>
                        <td className="py-3 px-4 text-right">{n.requiredConfirmations}</td>
                        <td className="py-3 px-4 text-right">{n.minDeposit}</td>
                        <td className="py-3 px-4 text-right">{n.minWithdrawal}</td>
                        <td className="py-3 px-4 text-right">
                          {n.networkFee} / {n.platformFee}
                        </td>
                        <td className="py-3 px-4 font-sans text-xs">
                          Dep: {n.isDepositEnabled ? 'On' : 'Off'} · Wd:{' '}
                          {n.isWithdrawalEnabled ? 'On' : 'Off'}
                        </td>
                        <td className="py-3 px-4 text-right font-sans">
                          <button
                            type="button"
                            onClick={() => startEditNetwork(n.id)}
                            className="px-3 py-1.5 rounded-full bg-[#004AE2] text-white text-xs font-medium"
                          >
                            Edit Rules
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {editingNetId && (
              <form
                onSubmit={handleSaveNetwork}
                className="rounded-2xl bg-white dark:bg-[#141518] border border-[#004AE2] p-5 space-y-4 max-w-2xl"
              >
                <h3 className="text-sm font-semibold">Edit Blockchain Network Rules</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="net-conf" className="block text-xs font-medium mb-1">
                      Required Confirmations
                    </label>
                    <input
                      id="net-conf"
                      type="number"
                      min="1"
                      value={netForm.requiredConfirmations}
                      onChange={(e) =>
                        setNetForm((p) => ({ ...p, requiredConfirmations: Number(e.target.value) }))
                      }
                      className="w-full h-10 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="net-mindep" className="block text-xs font-medium mb-1">
                      Min Deposit
                    </label>
                    <input
                      id="net-mindep"
                      type="number"
                      step="any"
                      min="0"
                      value={netForm.minDeposit}
                      onChange={(e) =>
                        setNetForm((p) => ({ ...p, minDeposit: Number(e.target.value) }))
                      }
                      className="w-full h-10 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="net-minwd" className="block text-xs font-medium mb-1">
                      Min Withdrawal
                    </label>
                    <input
                      id="net-minwd"
                      type="number"
                      step="any"
                      min="0"
                      value={netForm.minWithdrawal}
                      onChange={(e) =>
                        setNetForm((p) => ({ ...p, minWithdrawal: Number(e.target.value) }))
                      }
                      className="w-full h-10 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="net-fee" className="block text-xs font-medium mb-1">
                      Network Fee
                    </label>
                    <input
                      id="net-fee"
                      type="number"
                      step="any"
                      min="0"
                      value={netForm.networkFee}
                      onChange={(e) =>
                        setNetForm((p) => ({ ...p, networkFee: Number(e.target.value) }))
                      }
                      className="w-full h-10 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="plat-fee" className="block text-xs font-medium mb-1">
                      Platform Fee
                    </label>
                    <input
                      id="plat-fee"
                      type="number"
                      step="any"
                      min="0"
                      value={netForm.platformFee}
                      onChange={(e) =>
                        setNetForm((p) => ({ ...p, platformFee: Number(e.target.value) }))
                      }
                      className="w-full h-10 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-sm"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-6 text-xs">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={netForm.isDepositEnabled}
                      onChange={(e) =>
                        setNetForm((p) => ({ ...p, isDepositEnabled: e.target.checked }))
                      }
                      className="w-4 h-4 accent-[#004AE2]"
                    />
                    <span>Deposits Enabled</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={netForm.isWithdrawalEnabled}
                      onChange={(e) =>
                        setNetForm((p) => ({ ...p, isWithdrawalEnabled: e.target.checked }))
                      }
                      className="w-4 h-4 accent-[#004AE2]"
                    />
                    <span>Withdrawals Enabled</span>
                  </label>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    className="px-5 h-10 rounded-full bg-[#004AE2] text-white text-xs font-semibold"
                  >
                    Save Network Rules
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingNetId(null)}
                    className="px-5 h-10 rounded-full bg-[#E8EAEE] dark:bg-[#242528] text-xs font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {tab === 'addresses' && (
          <div className="space-y-6">
            <form
              onSubmit={handleAssignAddress}
              className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-6 space-y-4 max-w-2xl"
            >
              <h2 className="text-base font-semibold">Assign Genuine Deposit Address to Customer</h2>
              <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                Administrators can assign genuine deposit addresses supplied by the custody provider to customer accounts.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="admin-cust" className="block text-xs font-medium mb-1">
                    Customer
                  </label>
                  <select
                    id="admin-cust"
                    value={addrCustomerUserId}
                    onChange={(e) => setAddrCustomerUserId(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-xs"
                  >
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.fullName} ({p.email}) — ID {p.publicUserId}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="admin-ast" className="block text-xs font-medium mb-1">
                      Asset
                    </label>
                    <select
                      id="admin-ast"
                      value={addrAsset}
                      onChange={(e) => setAddrAsset(e.target.value)}
                      className="w-full h-11 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-xs"
                    >
                      {['USDT', 'BTC', 'ETH', 'SOL'].map((sym) => (
                        <option key={sym} value={sym}>
                          {sym}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="admin-net" className="block text-xs font-medium mb-1">
                      Network
                    </label>
                    <select
                      id="admin-net"
                      value={addrNetworkCode}
                      onChange={(e) => setAddrNetworkCode(e.target.value)}
                      className="w-full h-11 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-xs"
                    >
                      {addrNetworks.map((n) => (
                        <option key={n.id} value={n.code}>
                          {n.code}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="admin-addr" className="block text-xs font-medium mb-1">
                  Deposit Address
                </label>
                <input
                  id="admin-addr"
                  type="text"
                  value={addrValue}
                  onChange={(e) => setAddrValue(e.target.value)}
                  placeholder="e.g. 0x71C... or TXYZ..."
                  required
                  className="w-full h-11 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-xs"
                />
              </div>

              <div>
                <label htmlFor="admin-memo" className="block text-xs font-medium mb-1">
                  Destination Tag / Memo (Optional)
                </label>
                <input
                  id="admin-memo"
                  type="text"
                  value={addrMemo}
                  onChange={(e) => setAddrMemo(e.target.value)}
                  placeholder="Memo or Tag if required"
                  className="w-full h-11 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-xs"
                />
              </div>

              <button
                type="submit"
                className="px-6 h-11 rounded-full bg-[#004AE2] text-white text-xs font-semibold hover:bg-[#003ec0]"
              >
                Assign Deposit Address
              </button>
            </form>

            <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
              <div className="px-5 py-4 border-b border-[#E2E4E9] dark:border-[#22242A]">
                <h3 className="text-sm font-semibold">Assigned Deposit Addresses ({depositAddresses.length})</h3>
              </div>
              {depositAddresses.length === 0 ? (
                <p className="p-5 text-xs text-[#686D76]">No deposit addresses assigned yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[#E8EAEE] dark:bg-[#262629] text-left text-[#686D76]">
                        <th className="py-3 px-4 font-medium">Customer</th>
                        <th className="py-3 px-4 font-medium">Asset / Network</th>
                        <th className="py-3 px-4 font-medium">Address</th>
                        <th className="py-3 px-4 font-medium">Memo</th>
                        <th className="py-3 px-4 font-medium">Created At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                      {depositAddresses.map((da) => {
                        const cust = profileMap.get(da.userId);
                        return (
                          <tr key={da.id}>
                            <td className="py-3 px-4">
                              <p className="font-semibold">{cust?.fullName ?? 'Customer'}</p>
                              <p className="text-[11px] text-[#686D76]">{cust?.email}</p>
                            </td>
                            <td className="py-3 px-4 font-semibold">
                              {da.assetSymbol} ({da.networkCode})
                            </td>
                            <td className="py-3 px-4 font-mono-num truncate max-w-[200px]">
                              {da.address}
                            </td>
                            <td className="py-3 px-4 font-mono-num">{da.memoOrTag || '—'}</td>
                            <td className="py-3 px-4 text-[#686D76]">
                              {new Date(da.createdAt).toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Platform Manual Purchase Receiving Address Registry */}
            <div className="border-t border-[#E2E4E9] dark:border-[#22242A] pt-6 space-y-6">
              <form
                onSubmit={handleSaveReceivingAddress}
                data-testid="receiving-address-form"
                className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-6 space-y-4 max-w-2xl"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">
                      Manual Crypto Purchase Receiving Addresses
                    </h2>
                    <p className="text-xs text-[#686D76] dark:text-[#7E828A] mt-1">
                      Configure platform receiving addresses displayed to customers requesting manual crypto purchases. Disabling an address prevents new selections without mutating already-submitted orders.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="rec-asset" className="block text-xs font-medium mb-1">
                      Payment Asset
                    </label>
                    <select
                      id="rec-asset"
                      value={recAsset}
                      onChange={(e) => {
                        const nextAsset = e.target.value;
                        setRecAsset(nextAsset);
                        const match = networks.find((n) => n.assetSymbol === nextAsset);
                        if (match) setRecNetworkCode(match.code);
                      }}
                      className="w-full h-11 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-xs"
                    >
                      {['USDT', 'USDC', 'BTC', 'ETH', 'SOL'].map((sym) => (
                        <option key={sym} value={sym}>
                          {sym}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="rec-net" className="block text-xs font-medium mb-1">
                      Transfer Network
                    </label>
                    <select
                      id="rec-net"
                      value={recNetworkCode}
                      onChange={(e) => setRecNetworkCode(e.target.value)}
                      className="w-full h-11 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-xs"
                    >
                      {(recNetworks.length > 0
                        ? recNetworks.map((n) => n.code)
                        : ['TRC-20', 'ERC-20', 'BEP-20', 'SOL']
                      ).map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="rec-label" className="block text-xs font-medium mb-1">
                      Wallet Label
                    </label>
                    <input
                      id="rec-label"
                      type="text"
                      value={recLabel}
                      onChange={(e) => setRecLabel(e.target.value)}
                      placeholder="e.g. Settlement Desk TRC-20"
                      className="w-full h-11 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label htmlFor="rec-address" className="block text-xs font-medium mb-1">
                      Receiving Address
                    </label>
                    <input
                      id="rec-address"
                      data-testid="rec-address-input"
                      type="text"
                      required
                      value={recAddress}
                      onChange={(e) => setRecAddress(e.target.value)}
                      placeholder="Enter verified custody / treasury receiving address"
                      className="w-full h-11 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="rec-memo" className="block text-xs font-medium mb-1">
                      Memo / Tag (Optional)
                    </label>
                    <input
                      id="rec-memo"
                      type="text"
                      value={recMemo}
                      onChange={(e) => setRecMemo(e.target.value)}
                      placeholder="Optional memo or tag"
                      className="w-full h-11 px-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-xs"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  data-testid="save-receiving-address-button"
                  className="px-6 h-11 rounded-full bg-[#004AE2] text-white text-xs font-semibold hover:bg-[#003ec0]"
                >
                  Save Receiving Address
                </button>
              </form>

              <div className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
                <div className="px-5 py-4 border-b border-[#E2E4E9] dark:border-[#22242A]">
                  <h3 className="text-sm font-semibold">
                    Configured Receiving Addresses ({receivingAddresses.length})
                  </h3>
                </div>
                {receivingAddresses.length === 0 ? (
                  <p className="p-5 text-xs text-[#686D76] dark:text-[#7E828A]">
                    No manual purchase receiving addresses configured yet. Add an address above before customers request manual purchases.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[#E8EAEE] dark:bg-[#262629] text-left text-[#686D76] dark:text-[#7E828A]">
                          <th className="py-3 px-4 font-medium">Asset / Network</th>
                          <th className="py-3 px-4 font-medium">Label</th>
                          <th className="py-3 px-4 font-medium">Address</th>
                          <th className="py-3 px-4 font-medium">Memo</th>
                          <th className="py-3 px-4 font-medium">Status</th>
                          <th className="py-3 px-4 font-medium">Audit Trail</th>
                          <th className="py-3 px-4 font-medium text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                        {receivingAddresses.map((ra) => {
                          const assignedBy = profileMap.get(ra.assignedBy);
                          const latestAudit = ra.auditHistory[0];
                          return (
                            <tr key={ra.id}>
                              <td className="py-3 px-4 font-semibold">
                                {ra.assetSymbol} ({ra.networkCode})
                              </td>
                              <td className="py-3 px-4">
                                <p className="font-medium">{ra.label}</p>
                                <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                                  By {assignedBy?.fullName ?? ra.assignedByLabel}
                                </p>
                              </td>
                              <td className="py-3 px-4 font-mono-num break-all max-w-[220px]">
                                {ra.address}
                              </td>
                              <td className="py-3 px-4 font-mono-num">{ra.memoOrTag || '—'}</td>
                              <td className="py-3 px-4 font-semibold">
                                <span
                                  className={
                                    ra.isActive ? 'text-[#10C478]' : 'text-[#686D76] dark:text-[#7E828A]'
                                  }
                                >
                                  {ra.isActive ? 'ACTIVE' : 'DISABLED'}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-[11px] text-[#686D76] dark:text-[#7E828A]">
                                <p>{latestAudit?.note || 'Configured'}</p>
                                <p className="font-mono-num">
                                  {ra.auditHistory.length} event(s) ·{' '}
                                  {new Date(ra.updatedAt).toLocaleString()}
                                </p>
                              </td>
                              <td className="py-3 px-4 text-right">
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const res = await toggleReceivingAddressStatus(
                                      ra.id,
                                      !ra.isActive,
                                      ra.isActive
                                        ? 'Disabled by admin from address registry.'
                                        : 'Reactivated by admin from address registry.'
                                    );
                                    setFeedback({ ok: res.ok, text: res.message });
                                  }}
                                  className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
                                    ra.isActive
                                      ? 'bg-[#E8EAEE] dark:bg-[#242528] text-[#F0525E]'
                                      : 'bg-[#10C478] text-white'
                                  }`}
                                >
                                  {ra.isActive ? 'Disable' : 'Activate'}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
};
