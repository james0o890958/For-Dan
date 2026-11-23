import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Lock, Moon, ShieldCheck, Sun } from 'lucide-react';
import { useAppState } from '../../context/AppStateContext';
import { ChangeBadge, CoinAvatar, MarketFeedLabel } from '../../components/ui/CommonPrimitives';
import { formatCryptoPrice } from '../../utils/tradingMath';

export const LandingPage: React.FC = () => {
  const {
    theme,
    toggleTheme,
    currentProfile,
    isAdmin,
    marketPrices,
    assets,
    marketSettings,
  } = useAppState();

  const assetMap = new Map(assets.map((a) => [a.symbol, a]));

  return (
    <div className="min-h-screen bg-[#F4F5F7] dark:bg-[#0B0C0E] text-[#111214] dark:text-[#F4F5F7]">
      {/* Functional Top Bar without any brand identity */}
      <header className="border-b border-[#E2E4E9] dark:border-[#1E2026] bg-white/90 dark:bg-[#0B0C0E]/90 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-6">
          <span className="text-base font-semibold whitespace-nowrap shrink-0">
            Spot Exchange
          </span>

          <nav
            aria-label="Public navigation"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-[#4B5059] dark:text-[#9CA0A8]"
          >
            <Link to="/overview" className="hover:text-[#111214] dark:hover:text-white whitespace-nowrap shrink-0">
              Overview
            </Link>
            <Link to="/markets" className="hover:text-[#111214] dark:hover:text-white whitespace-nowrap shrink-0">
              Markets
            </Link>
            <Link to="/register" className="hover:text-[#111214] dark:hover:text-white whitespace-nowrap shrink-0">
              Create New Account
            </Link>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-2 rounded-full hover:bg-[#E8EAEE] dark:hover:bg-[#242528] min-h-[40px] min-w-[40px] flex items-center justify-center"
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <Link
              to={currentProfile ? (isAdmin ? '/admin' : '/overview') : '/login'}
              className="px-4 py-2 rounded-full bg-[#004AE2] text-white text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 hover:bg-[#003ec0]"
            >
              {currentProfile ? (isAdmin ? 'Admin Console' : 'Overview') : 'Sign in'}
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Hero Banner with a single primary CTA: Create New Account */}
        <section className="relative overflow-hidden rounded-2xl border border-[#22242A] bg-gradient-to-br from-[#06183A] via-[#0B2A6B] to-[#081020] text-white p-6 sm:p-10">
          <div className="max-w-2xl space-y-4">
            <p className="text-xs font-medium text-blue-200/90">
              Digital Asset Spot Exchange · Verified Custody & Ledger Controls
            </p>
            <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight leading-tight text-balance">
              Cryptocurrency spot trading with verified blockchain deposits and controlled withdrawals
            </h1>
            <p className="text-sm sm:text-base text-blue-100/80 leading-relaxed">
              Open an individual account with segregated available and reserved asset balances, complete identity compliance verification, track on-chain confirmations, and manage spot trades through an immutable ledger.
            </p>

            <div className="pt-2 flex flex-wrap items-center gap-3">
              <Link
                to="/register"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white text-[#111214] text-sm font-semibold hover:bg-neutral-200 whitespace-nowrap"
              >
                <span>Create New Account</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </section>

        {/* Core Controls Overview */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-[#004AE2] shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-xs sm:text-sm">
              <p className="font-semibold text-[#111214] dark:text-[#F4F5F7]">
                Verified On-Chain Deposit Settlement
              </p>
              <p className="mt-0.5 text-[#686D76] dark:text-[#7E828A]">
                Deposits require blockchain transaction hash detection, network and destination address matching, required confirmations, KYT screening, and single-credit ledger approval.
              </p>
            </div>
          </div>
          <div className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] p-4 flex items-start gap-3">
            <Lock className="w-5 h-5 text-[#10C478] shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-xs sm:text-sm">
              <p className="font-semibold text-[#111214] dark:text-[#F4F5F7]">
                Segregated Custody & Withdrawal Controls
              </p>
              <p className="mt-0.5 text-[#686D76] dark:text-[#7E828A]">
                Withdrawals require Two-Factor Authentication (2FA), available balance reservation, compliance risk scoring, and dual-control administrative approval for high-value requests.
              </p>
            </div>
          </div>
        </section>

        {/* Public Market Snapshot */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Markets Overview</h2>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-[#686D76] dark:text-[#7E828A]">
                <MarketFeedLabel status={marketSettings.providerStatus} />
                <span aria-hidden="true">·</span>
                <span>{marketSettings.providerName}</span>
              </div>
            </div>
            <Link
              to="/markets"
              className="text-sm font-medium text-[#004AE2] dark:text-[#60A5FA] hover:underline"
            >
              View all markets
            </Link>
          </div>

          <div className="rounded-xl bg-white dark:bg-[#141518] border border-[#E2E4E9] dark:border-[#22242A] overflow-hidden">
            <div className="grid grid-cols-12 px-4 py-3 bg-[#E8EAEE] dark:bg-[#262629] text-xs font-medium text-[#686D76] dark:text-[#7E828A]">
              <div className="col-span-5">Name</div>
              <div className="col-span-4 text-right sm:text-left">MarketPrice</div>
              <div className="col-span-3 text-right">Change</div>
            </div>
            <div className="divide-y divide-[#E2E4E9] dark:divide-[#1E1F23]">
              {marketPrices.map((mp) => {
                const base = mp.symbol.split('/')[0];
                const asset = assetMap.get(base);
                const unavailable = mp.price <= 0;
                return (
                  <Link
                    key={mp.symbol}
                    to={`/markets/${encodeURIComponent(mp.symbol)}`}
                    className="grid grid-cols-12 items-center px-4 py-3.5 hover:bg-[#F4F5F7] dark:hover:bg-[#1A1B20] transition-colors"
                  >
                    <div className="col-span-5 flex items-center gap-3 min-w-0">
                      <CoinAvatar symbol={base} color={asset?.badgeColor} size="sm" />
                      <div className="truncate">
                        <span className="font-semibold text-sm text-[#111214] dark:text-white">
                          {base}
                        </span>
                        <span className="text-xs text-[#686D76] dark:text-[#7E828A]">/USDT</span>
                      </div>
                    </div>
                    <div className="col-span-4 text-right sm:text-left min-w-0">
                      <p className="font-mono-num text-sm font-semibold">
                        {unavailable ? 'Feed Offline' : formatCryptoPrice(mp.price)}
                      </p>
                      <p className="font-mono-num text-[11px] text-[#686D76] dark:text-[#7E828A] whitespace-nowrap truncate">
                        24H {unavailable ? '—' : mp.volume24h.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="col-span-3 flex justify-end">
                      <ChangeBadge changePct={mp.change24hPct} unavailable={unavailable} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};
