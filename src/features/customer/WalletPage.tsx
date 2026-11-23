import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Eye,
  EyeOff,
  FileText,
  History,
  ReceiptText,
  ShieldCheck,
} from 'lucide-react';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import {
  CoinAvatar,
  DepositStatusLabel,
  EmptyState,
  WithdrawalStatusLabel,
} from '../../components/ui/CommonPrimitives';
import { useAppState } from '../../context/AppStateContext';
import { previewWithdrawal } from '../../utils/exchangeEngine';
import {
  calculatePortfolioSummary,
  formatQty,
  formatUsdt,
  roundAmount,
} from '../../utils/tradingMath';

export const WalletPage: React.FC<{
  mode?: 'wallets' | 'deposit' | 'withdraw';
}> = ({ mode = 'wallets' }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab =
    mode === 'withdraw'
      ? 'withdraw'
      : mode === 'deposit'
        ? 'deposit'
        : searchParams.get('tab') === 'withdraw'
          ? 'withdraw'
          : 'deposit';

  const pageTitle =
    mode === 'deposit' ? 'Deposit' : mode === 'withdraw' ? 'Withdraw' : 'Wallets';

  const {
    currentProfile,
    currentUserBalances,
    currentUserDepositAddresses,
    currentUserDeposits,
    currentUserWithdrawals,
    networks,
    marketPrices,
    assets,
    hideBalances,
    toggleHideBalances,
    requestDepositAddress,
    requestWithdrawal,
    cancelWithdrawal,
  } = useAppState();

  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>(initialTab);
  useEffect(() => {
    if (mode === 'withdraw') {
      setActiveTab('withdraw');
    } else if (mode === 'deposit') {
      setActiveTab('deposit');
    } else {
      setActiveTab(searchParams.get('tab') === 'withdraw' ? 'withdraw' : 'deposit');
    }
  }, [mode, searchParams]);

  const switchTab = (tab: 'deposit' | 'withdraw') => {
    setActiveTab(tab);
    if (mode === 'wallets') {
      setSearchParams(tab === 'withdraw' ? { tab: 'withdraw' } : {});
    }
  };

  // Deposit state
  const depositAssets = useMemo(() => {
    const syms = Array.from(new Set(networks.map((n) => n.assetSymbol)));
    return syms;
  }, [networks]);

  const [depAsset, setDepAsset] = useState<string>(depositAssets[0] ?? 'USDT');
  const depNetworks = useMemo(
    () => networks.filter((n) => n.assetSymbol === depAsset),
    [networks, depAsset]
  );
  const [depNetworkCode, setDepNetworkCode] = useState<string>(
    depNetworks[0]?.code ?? 'TRC-20'
  );
  useEffect(() => {
    if (!depNetworks.some((n) => n.code === depNetworkCode)) {
      setDepNetworkCode(depNetworks[0]?.code ?? '');
    }
  }, [depNetworks, depNetworkCode]);

  const [depLoading, setDepLoading] = useState(false);
  const [depFeedback, setDepFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Withdrawal state
  const [wdAsset, setWdAsset] = useState<string>(depositAssets[0] ?? 'USDT');
  const wdNetworks = useMemo(
    () => networks.filter((n) => n.assetSymbol === wdAsset),
    [networks, wdAsset]
  );
  const [wdNetworkCode, setWdNetworkCode] = useState<string>(wdNetworks[0]?.code ?? 'TRC-20');
  useEffect(() => {
    if (!wdNetworks.some((n) => n.code === wdNetworkCode)) {
      setWdNetworkCode(wdNetworks[0]?.code ?? '');
    }
  }, [wdNetworks, wdNetworkCode]);

  const [wdAddress, setWdAddress] = useState('');
  const [wdMemo, setWdMemo] = useState('');
  const [wdAmount, setWdAmount] = useState('');
  const [wdTwoFactor, setWdTwoFactor] = useState('');
  const [wdFeedback, setWdFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const summary = useMemo(
    () => calculatePortfolioSummary(currentUserBalances, marketPrices, assets),
    [currentUserBalances, marketPrices, assets]
  );

  const activeDepNetwork =
    depNetworks.find((n) => n.code === depNetworkCode) ?? depNetworks[0];
  const assignedDepositAddress = currentUserDepositAddresses.find(
    (d) => d.assetSymbol === depAsset && d.networkCode === depNetworkCode
  );

  const activeWdNetwork =
    wdNetworks.find((n) => n.code === wdNetworkCode) ?? wdNetworks[0];
  const wdAssetBal =
    currentUserBalances.find((b) => b.assetSymbol === wdAsset)?.available ?? 0;
  const wdMarketPrice =
    wdAsset === 'USDT'
      ? 1
      : marketPrices.find((m) => m.symbol === `${wdAsset}/USDT`)?.price ?? 0;

  const wdQuote = useMemo(() => {
    if (!currentProfile) return null;
    return previewWithdrawal({
      accountStatus: currentProfile.accountStatus,
      kycStatus: currentProfile.kycStatus,
      twoFactorEnabled: currentProfile.twoFactorEnabled,
      twoFactorCode: wdTwoFactor,
      network: activeWdNetwork,
      destinationAddress: wdAddress,
      memoOrTag: wdMemo,
      grossAmount: Number(wdAmount),
      availableBalance: wdAssetBal,
      estimatedUsdtPrice: wdMarketPrice,
    });
  }, [
    currentProfile,
    wdTwoFactor,
    activeWdNetwork,
    wdAddress,
    wdMemo,
    wdAmount,
    wdAssetBal,
    wdMarketPrice,
  ]);

  if (!currentProfile) {
    return (
      <CustomerLayout
        title={pageTitle}
        subtitle="Sandbox environment · Authenticate to inspect custody vaults, network rules, and segregated account balances"
      >
        <EmptyState
          title={`Sign in to access ${pageTitle}`}
          description="Live custody deposit addresses and 2FA withdrawal submissions require an authenticated account and approved KYC. No real blockchain operations execute in sandbox preview."
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/login"
                className="inline-flex px-5 py-2.5 rounded-lg bg-[#004AE2] text-white text-sm font-semibold hover:bg-[#003ec0]"
              >
                Sign in
              </Link>
              <Link
                to="/overview"
                className="inline-flex px-5 py-2.5 rounded-lg bg-[#E8EAEE] dark:bg-[#242528] text-sm font-medium"
              >
                Back to Overview
              </Link>
            </div>
          }
        />
      </CustomerLayout>
    );
  }

  const handleRequestDepositAddress = async () => {
    setDepLoading(true);
    setDepFeedback(null);
    const res = await requestDepositAddress({
      assetSymbol: depAsset,
      networkCode: depNetworkCode,
    });
    setDepLoading(false);
    setDepFeedback({ ok: res.ok, text: res.message });
  };

  const handleWithdrawalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const res = requestWithdrawal({
      assetSymbol: wdAsset,
      networkCode: wdNetworkCode,
      destinationAddress: wdAddress,
      memoOrTag: wdMemo,
      grossAmount: Number(wdAmount),
      twoFactorCode: wdTwoFactor,
    });
    setWdFeedback({ ok: res.ok, text: res.message });
    if (res.ok) {
      setWdAddress('');
      setWdMemo('');
      setWdAmount('');
      setWdTwoFactor('');
    }
  };

  const parsedWdAmount = Number(wdAmount);
  const totalFee = activeWdNetwork
    ? roundAmount(activeWdNetwork.networkFee + activeWdNetwork.platformFee, 8)
    : 0;
  const estNetReceived =
    Number.isFinite(parsedWdAmount) && parsedWdAmount > totalFee
      ? roundAmount(parsedWdAmount - totalFee, 8)
      : 0;

  return (
    <CustomerLayout title={pageTitle}>
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column: Asset Valuation, Actions & Segregated Balances */}
          <div className="lg:col-span-5 space-y-4">
            <div className="rounded-2xl bg-[#004AE2] text-white p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-blue-100">Total asset valuation</span>
                <button
                  type="button"
                  onClick={toggleHideBalances}
                  aria-label={hideBalances ? 'Show balances' : 'Hide balances'}
                  className="p-1.5 rounded-full hover:bg-white/15"
                >
                  {hideBalances ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              <p className="mt-3 text-3xl font-bold font-mono-num">
                {hideBalances ? '•••••• USDT' : `${formatUsdt(summary.totalUsdt)} USDT`}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-blue-100/90 font-mono-num">
                <span>
                  Available USDT: {hideBalances ? '••••' : formatUsdt(summary.availableUsdt)}
                </span>
                <span>
                  Reserved USDT: {hideBalances ? '••••' : formatUsdt(summary.reservedUsdt)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => switchTab('deposit')}
                className={`h-12 rounded-full text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                  activeTab === 'deposit'
                    ? 'bg-[#004AE2] text-white'
                    : 'bg-[#E8EAEE] dark:bg-[#2C2D30] text-[#111214] dark:text-white'
                }`}
              >
                <ArrowDownToLine className="w-4 h-4" />
                <span>Deposit</span>
              </button>
              <button
                type="button"
                onClick={() => switchTab('withdraw')}
                className={`h-12 rounded-full text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                  activeTab === 'withdraw'
                    ? 'bg-[#004AE2] text-white'
                    : 'bg-[#E8EAEE] dark:bg-[#2C2D30] text-[#111214] dark:text-white'
                }`}
              >
                <ArrowUpFromLine className="w-4 h-4" />
                <span>Withdraw</span>
              </button>
            </div>

            {/* Segregated Asset Balances */}
            <div className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
              <div className="px-4 py-2.5 bg-[#E8EAEE] dark:bg-[#262629] flex items-center justify-between text-[11px] font-medium text-[#686D76] dark:text-[#7E828A] rounded-t-xl">
                <span>Asset</span>
                <span>Available / Reserved</span>
              </div>
              {summary.holdings.length === 0 ? (
                <div className="p-4 text-xs text-[#686D76] dark:text-[#7E828A]">
                  Zero balances across all supported assets.
                </div>
              ) : (
                summary.holdings.map((h) => (
                  <div key={h.symbol} className="px-4 py-3.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <CoinAvatar symbol={h.symbol} color={h.badgeColor} size="sm" />
                      <div>
                        <p className="text-sm font-semibold">{h.symbol}</p>
                        <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">{h.name}</p>
                      </div>
                    </div>
                    <div className="text-right font-mono-num">
                      <p className="text-sm font-semibold">
                        {hideBalances ? '••••' : formatQty(h.available)}
                      </p>
                      <p className="text-[11px] text-[#686D76] dark:text-[#7E828A]">
                        Reserved: {hideBalances ? '••••' : formatQty(h.reserved)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-3 pt-1">
              <h2 className="text-sm font-semibold">Records</h2>
              <div className="grid grid-cols-3 gap-3 text-center">
                <a
                  href="#deposit-history"
                  onClick={() => switchTab('deposit')}
                  className="p-3 rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] flex flex-col items-center gap-2 hover:border-[#004AE2]/60"
                >
                  <FileText className="w-5 h-5" aria-hidden="true" />
                  <span className="text-xs font-medium">Deposit History</span>
                </a>
                <a
                  href="#withdrawal-history"
                  onClick={() => switchTab('withdraw')}
                  className="p-3 rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] flex flex-col items-center gap-2 hover:border-[#004AE2]/60"
                >
                  <History className="w-5 h-5" aria-hidden="true" />
                  <span className="text-xs font-medium">Withdrawals</span>
                </a>
                <Link
                  to="/transactions"
                  className="p-3 rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] flex flex-col items-center gap-2 hover:border-[#004AE2]/60"
                >
                  <ReceiptText className="w-5 h-5" aria-hidden="true" />
                  <span className="text-xs font-medium">Ledger Records</span>
                </Link>
              </div>
            </div>
          </div>

          {/* Right Column: Deposit OR Withdrawal Operations */}
          <div className="lg:col-span-7 space-y-5">
            {currentProfile.kycStatus !== 'approved' && (
              <div className="p-4 rounded-xl bg-[#D97706]/10 border border-[#D97706]/40 text-xs flex flex-wrap items-center justify-between gap-2">
                <span>
                  Approved KYC verification is required before generating deposit addresses or requesting withdrawals.
                </span>
                <Link to="/kyc" className="font-semibold text-[#004AE2] dark:text-[#60A5FA]">
                  Complete KYC
                </Link>
              </div>
            )}

            {currentProfile.accountStatus === 'suspended' && (
              <div className="p-4 rounded-xl bg-[#F0525E]/10 border border-[#F0525E]/40 text-xs font-medium text-[#F0525E]">
                Your account is currently suspended. Deposits and withdrawals are disabled.
              </div>
            )}

            {activeTab === 'deposit' ? (
              <>
                <section className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-base font-semibold">Cryptocurrency Deposit</h2>
                    <span className="text-xs text-[#686D76] dark:text-[#7E828A]">
                      On-chain Verification Required
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="dep-asset" className="block text-xs font-medium mb-1.5">
                        Asset
                      </label>
                      <select
                        id="dep-asset"
                        value={depAsset}
                        onChange={(e) => {
                          setDepAsset(e.target.value);
                          setDepFeedback(null);
                        }}
                        className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm"
                      >
                        {depositAssets.map((sym) => (
                          <option key={sym} value={sym}>
                            {sym}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="dep-network" className="block text-xs font-medium mb-1.5">
                        Network
                      </label>
                      <select
                        id="dep-network"
                        value={depNetworkCode}
                        onChange={(e) => {
                          setDepNetworkCode(e.target.value);
                          setDepFeedback(null);
                        }}
                        className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm"
                      >
                        {depNetworks.map((n) => (
                          <option key={n.id} value={n.code}>
                            {n.code} — {n.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {activeDepNetwork && (
                    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] p-3.5 text-xs">
                      <div>
                        <dt className="text-[#686D76] dark:text-[#7E828A]">Required Confirmations</dt>
                        <dd className="font-mono-num font-semibold mt-0.5">
                          {activeDepNetwork.requiredConfirmations} blocks
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[#686D76] dark:text-[#7E828A]">Minimum Deposit</dt>
                        <dd className="font-mono-num font-semibold mt-0.5">
                          {activeDepNetwork.minDeposit} {activeDepNetwork.assetSymbol}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[#686D76] dark:text-[#7E828A]">Destination Tag / Memo</dt>
                        <dd className="font-semibold mt-0.5">
                          {activeDepNetwork.memoRequired ? 'Mandatory' : 'Not Required'}
                        </dd>
                      </div>
                    </dl>
                  )}

                  {assignedDepositAddress ? (
                    <div className="rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] p-4 space-y-2 text-xs">
                      <p className="text-[#686D76] dark:text-[#7E828A]">
                        Assigned {depAsset} ({depNetworkCode}) Custody Deposit Address
                      </p>
                      <p className="font-mono-num text-sm font-semibold break-all">
                        {assignedDepositAddress.address}
                      </p>
                      {assignedDepositAddress.memoOrTag && (
                        <p className="font-mono-num">
                          Destination Tag: <strong>{assignedDepositAddress.memoOrTag}</strong>
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] p-4 space-y-3">
                      <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                        Deposit addresses are provisioned per customer directly from the custody vault provider. Deposits are detected automatically via blockchain webhook & confirmed on-chain before admin verification and single ledger credit.
                      </p>
                      <button
                        type="button"
                        disabled={
                          depLoading ||
                          currentProfile.kycStatus !== 'approved' ||
                          currentProfile.accountStatus === 'suspended' ||
                          !activeDepNetwork?.isDepositEnabled
                        }
                        onClick={handleRequestDepositAddress}
                        className="px-5 h-10 rounded-full bg-[#004AE2] text-white text-xs font-semibold hover:bg-[#003ec0] disabled:opacity-45 disabled:cursor-not-allowed"
                      >
                        {depLoading ? 'Requesting...' : 'Assign Custody Deposit Address'}
                      </button>
                    </div>
                  )}

                  {depFeedback && (
                    <p
                      role="status"
                      className={`text-xs font-medium ${
                        depFeedback.ok ? 'text-[#10C478]' : 'text-[#F0525E]'
                      }`}
                    >
                      {depFeedback.text}
                    </p>
                  )}
                </section>

                {/* Blockchain Deposit History */}
                <section
                  id="deposit-history"
                  className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-3"
                >
                  <h2 className="text-base font-semibold">Deposit Verification History</h2>
                  {currentUserDeposits.length === 0 ? (
                    <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                      No blockchain deposits detected for this account yet.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-[#686D76] dark:text-[#7E828A] border-b border-[#E2E4E9] dark:border-[#22242A]">
                            <th className="py-2 pr-3 font-medium">Asset / Network</th>
                            <th className="py-2 pr-3 font-medium">Tx Hash</th>
                            <th className="py-2 pr-3 font-medium text-right">Amount</th>
                            <th className="py-2 pr-3 font-medium">Confirmations</th>
                            <th className="py-2 pr-3 font-medium">Status</th>
                            <th className="py-2 font-medium">Note</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                          {currentUserDeposits.map((d) => (
                            <tr key={d.id}>
                              <td className="py-2.5 pr-3 font-medium whitespace-nowrap">
                                {d.assetSymbol} ({d.networkCode})
                              </td>
                              <td className="py-2.5 pr-3 font-mono-num truncate max-w-[140px]">
                                {d.txHash}
                              </td>
                              <td className="py-2.5 pr-3 text-right font-mono-num font-semibold">
                                {formatQty(d.amount)}
                              </td>
                              <td className="py-2.5 pr-3 font-mono-num">
                                {d.confirmations}/{d.requiredConfirmations}
                              </td>
                              <td className="py-2.5 pr-3">
                                <DepositStatusLabel status={d.status} />
                              </td>
                              <td className="py-2.5 text-[#686D76] dark:text-[#7E828A]">
                                {d.adminNote || 'Pending verification'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            ) : (
              <>
                <section className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-base font-semibold">Cryptocurrency Withdrawal</h2>
                    <span className="text-xs text-[#686D76] dark:text-[#7E828A]">
                      2FA & Risk Approval Required
                    </span>
                  </div>

                  {!currentProfile.twoFactorEnabled && (
                    <div className="p-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D97706]/50 text-xs flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-[#D97706]" />
                        Enable Two-Factor Authentication (2FA) in Settings before submitting withdrawals.
                      </span>
                      <Link to="/settings" className="font-semibold text-[#004AE2] dark:text-[#60A5FA]">
                        Security Settings
                      </Link>
                    </div>
                  )}

                  <form onSubmit={handleWithdrawalSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="wd-asset" className="block text-xs font-medium mb-1.5">
                          Asset
                        </label>
                        <select
                          id="wd-asset"
                          value={wdAsset}
                          onChange={(e) => {
                            setWdAsset(e.target.value);
                            setWdFeedback(null);
                          }}
                          className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm"
                        >
                          {depositAssets.map((sym) => (
                            <option key={sym} value={sym}>
                              {sym}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="wd-network" className="block text-xs font-medium mb-1.5">
                          Network
                        </label>
                        <select
                          id="wd-network"
                          value={wdNetworkCode}
                          onChange={(e) => {
                            setWdNetworkCode(e.target.value);
                            setWdFeedback(null);
                          }}
                          className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] text-sm"
                        >
                          {wdNetworks.map((n) => (
                            <option key={n.id} value={n.code}>
                              {n.code} — {n.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="wd-address" className="block text-xs font-medium mb-1.5">
                        Destination Wallet Address
                      </label>
                      <input
                        id="wd-address"
                        type="text"
                        value={wdAddress}
                        onChange={(e) => setWdAddress(e.target.value)}
                        placeholder={`Enter valid ${wdNetworkCode} destination address`}
                        className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-sm"
                      />
                    </div>

                    {activeWdNetwork?.memoRequired && (
                      <div>
                        <label htmlFor="wd-memo" className="block text-xs font-medium mb-1.5">
                          Destination Tag / Memo (Mandatory for {activeWdNetwork.code})
                        </label>
                        <input
                          id="wd-memo"
                          type="text"
                          value={wdMemo}
                          onChange={(e) => setWdMemo(e.target.value)}
                          placeholder="Enter numeric destination tag or memo"
                          className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-sm"
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <div className="flex items-center justify-between mb-1.5 text-xs">
                          <label htmlFor="wd-amount" className="font-medium">
                            Withdrawal Amount ({wdAsset})
                          </label>
                          <span className="font-mono-num text-[#686D76] dark:text-[#7E828A]">
                            Avail: {formatQty(wdAssetBal)}
                          </span>
                        </div>
                        <input
                          id="wd-amount"
                          type="number"
                          step="any"
                          min="0"
                          value={wdAmount}
                          onChange={(e) => setWdAmount(e.target.value)}
                          placeholder={
                            activeWdNetwork ? `Min ${activeWdNetwork.minWithdrawal}` : '0.00'
                          }
                          className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-sm"
                        />
                      </div>

                      <div>
                        <label htmlFor="wd-2fa" className="block text-xs font-medium mb-1.5">
                          6-Digit 2FA Security Confirmation
                        </label>
                        <input
                          id="wd-2fa"
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={wdTwoFactor}
                          onChange={(e) => setWdTwoFactor(e.target.value)}
                          placeholder="000000"
                          className="w-full h-11 px-3.5 rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#D4D7DF] dark:border-[#2B2C32] font-mono-num text-sm"
                        />
                      </div>
                    </div>

                    {/* Fee & Final Received Summary */}
                    {activeWdNetwork && (
                      <dl className="rounded-xl bg-[#F4F5F7] dark:bg-[#0B0C0E] border border-[#E2E4E9] dark:border-[#22242A] p-3.5 space-y-2 text-xs">
                        <div className="flex justify-between">
                          <dt className="text-[#686D76] dark:text-[#7E828A]">Network Fee</dt>
                          <dd className="font-mono-num font-semibold">
                            {activeWdNetwork.networkFee} {wdAsset}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-[#686D76] dark:text-[#7E828A]">Platform Fee</dt>
                          <dd className="font-mono-num font-semibold">
                            {activeWdNetwork.platformFee} {wdAsset}
                          </dd>
                        </div>
                        <div className="flex justify-between pt-1.5 border-t border-[#E2E4E9] dark:border-[#22242A]">
                          <dt className="font-semibold">Final Amount Received</dt>
                          <dd className="font-mono-num font-bold text-sm">
                            {estNetReceived > 0 ? `${formatQty(estNetReceived)} ${wdAsset}` : '—'}
                          </dd>
                        </div>
                      </dl>
                    )}

                    {wdQuote && !wdQuote.valid && wdQuote.error && wdAmount.trim() !== '' && (
                      <p role="alert" className="text-xs font-medium text-[#F0525E]">
                        {wdQuote.error}
                      </p>
                    )}

                    {wdFeedback && (
                      <p
                        role="status"
                        className={`text-xs font-medium ${
                          wdFeedback.ok ? 'text-[#10C478]' : 'text-[#F0525E]'
                        }`}
                      >
                        {wdFeedback.text}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={
                        currentProfile.kycStatus !== 'approved' ||
                        currentProfile.accountStatus === 'suspended' ||
                        !currentProfile.twoFactorEnabled
                      }
                      className="w-full sm:w-auto px-6 h-11 rounded-full bg-[#004AE2] text-white text-sm font-semibold hover:bg-[#003ec0] disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      Submit Withdrawal Request
                    </button>
                  </form>
                </section>

                {/* Withdrawal History */}
                <section
                  id="withdrawal-history"
                  className="rounded-2xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-5 space-y-3"
                >
                  <h2 className="text-base font-semibold">Withdrawal History</h2>
                  {currentUserWithdrawals.length === 0 ? (
                    <p className="text-xs text-[#686D76] dark:text-[#7E828A]">
                      No cryptocurrency withdrawal requests submitted yet.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-[#686D76] dark:text-[#7E828A] border-b border-[#E2E4E9] dark:border-[#22242A]">
                            <th className="py-2 pr-3 font-medium">Asset / Network</th>
                            <th className="py-2 pr-3 font-medium">Destination</th>
                            <th className="py-2 pr-3 font-medium text-right">Net Received</th>
                            <th className="py-2 pr-3 font-medium">Status</th>
                            <th className="py-2 font-medium text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
                          {currentUserWithdrawals.map((w) => {
                            const canCancel =
                              w.status === 'REQUESTED' ||
                              w.status === 'RISK_REVIEW' ||
                              w.status === 'PENDING_ADMIN_APPROVAL';
                            return (
                              <tr key={w.id}>
                                <td className="py-2.5 pr-3 font-medium whitespace-nowrap">
                                  {w.assetSymbol} ({w.networkCode})
                                </td>
                                <td className="py-2.5 pr-3 font-mono-num truncate max-w-[150px]">
                                  {w.destinationAddress}
                                </td>
                                <td className="py-2.5 pr-3 text-right font-mono-num font-semibold">
                                  {formatQty(w.netAmount)}
                                </td>
                                <td className="py-2.5 pr-3">
                                  <WithdrawalStatusLabel status={w.status} />
                                </td>
                                <td className="py-2.5 text-right">
                                  {canCancel ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const res = cancelWithdrawal(w.id);
                                        setWdFeedback({ ok: res.ok, text: res.message });
                                      }}
                                      className="text-xs font-semibold text-[#F0525E] hover:underline"
                                    >
                                      Cancel
                                    </button>
                                  ) : (
                                    <span className="text-[#686D76] dark:text-[#7E828A]">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </CustomerLayout>
  );
};
