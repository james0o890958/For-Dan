import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  INITIAL_ASSETS,
  INITIAL_AUDIT_LOGS,
  INITIAL_DEPOSIT_ADDRESSES,
  INITIAL_DEPOSITS,
  INITIAL_KYC_SUBMISSIONS,
  INITIAL_LEDGER_ENTRIES,
  INITIAL_LEDGER_TRANSACTIONS,
  INITIAL_MARKET_PRICES,
  INITIAL_MARKET_SETTINGS,
  INITIAL_NETWORKS,
  INITIAL_NOTIFICATIONS,
  INITIAL_NOTIFICATION_CAMPAIGNS,
  INITIAL_PROFILES,
  INITIAL_RECONCILIATION_RUNS,
  INITIAL_SPOT_ORDERS,
  INITIAL_TRADES,
  INITIAL_TRADING_PAIRS,
  INITIAL_USER_ROLES,
  INITIAL_WALLET_BALANCES,
  INITIAL_WITHDRAWALS,
} from '../data/exchangeSeed';
import {
  exchangeService,
  type LedgerAdjustmentInput,
  type RegisterInput,
  type SendCampaignInput,
  type SpotTradeInput,
  type WithdrawalRequestInput,
} from '../services/platformService';
import {
  INITIAL_PROVIDER_HEALTH,
  unconfiguredCustodyProvider,
  unconfiguredLiquidityProvider,
} from '../services/providerAdapters';
import type {
  AccountStatus,
  AdminAuditLog,
  AppRole,
  Asset,
  DepositAddress,
  DepositRecord,
  KycSubmission,
  LedgerEntry,
  LedgerTransaction,
  MarketDataStatus,
  MarketPrice,
  MarketSettings,
  NetworkConfig,
  NotificationCampaign,
  NotificationItem,
  Profile,
  ProviderHealth,
  ReconciliationRun,
  SpotOrder,
  Trade,
  TradingPair,
  UserRoleRecord,
  WalletBalance,
  WithdrawalRequest,
} from '../types/domain';
import {
  applyDepositApproval,
  applyWithdrawalApprovalDecision,
  finalizeWithdrawalCompletion,
  previewWithdrawal,
  refundReservedWithdrawal,
} from '../utils/exchangeEngine';
import {
  calculateSpotBuyPreview,
  calculateSpotSellPreview,
  roundAmount,
} from '../utils/tradingMath';
import {
  parseStoredWatchlist,
  toggleWatchlistSymbol,
  WATCHLIST_STORAGE_KEY,
} from '../utils/overviewModel';

export interface ActionResult {
  ok: boolean;
  message: string;
}

interface AppStateContextValue {
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  language: string;
  setLanguage: (lang: string) => void;
  hideBalances: boolean;
  toggleHideBalances: () => void;

  // Auth & Role (backed by Supabase Auth & PostgreSQL user_roles)
  currentUserId: string | null;
  currentProfile: Profile | null;
  currentRole: AppRole;
  isAdmin: boolean;
  authLoading: boolean;
  login: (identifier: string, password: string) => Promise<ActionResult & { role?: AppRole }>;
  register: (input: RegisterInput) => Promise<ActionResult>;
  logout: () => Promise<void>;
  recoverPassword: (identifier: string) => Promise<ActionResult>;
  updatePassword: (currentPassword: string, newPassword: string) => Promise<ActionResult>;

  // Collections
  profiles: Profile[];
  customerProfiles: Profile[];
  userRoles: UserRoleRecord[];
  assets: Asset[];
  networks: NetworkConfig[];
  tradingPairs: TradingPair[];
  marketPrices: MarketPrice[];
  marketSettings: MarketSettings;
  marketLoading: boolean;
  marketFeedIsCached: boolean;
  marketFeedError: string | null;
  refreshMarketTickers: () => Promise<void>;
  watchlist: string[];
  toggleWatchlist: (symbol: string) => void;
  isWatchlisted: (symbol: string) => boolean;
  providerHealth: ProviderHealth[];
  reconciliationRuns: ReconciliationRun[];
  walletBalances: WalletBalance[];
  depositAddresses: DepositAddress[];
  deposits: DepositRecord[];
  withdrawals: WithdrawalRequest[];
  kycSubmissions: KycSubmission[];
  spotOrders: SpotOrder[];
  trades: Trade[];
  ledgerTransactions: LedgerTransaction[];
  ledgerEntries: LedgerEntry[];
  notificationCampaigns: NotificationCampaign[];
  notifications: NotificationItem[];
  auditLogs: AdminAuditLog[];

  // Derived for current user
  currentUserBalances: WalletBalance[];
  currentUserKyc: KycSubmission | null;
  currentUserDepositAddresses: DepositAddress[];
  currentUserDeposits: DepositRecord[];
  currentUserWithdrawals: WithdrawalRequest[];
  currentUserOrders: SpotOrder[];
  currentUserTrades: Trade[];
  currentUserTransactions: LedgerTransaction[];
  currentUserNotifications: NotificationItem[];
  unreadNotificationsCount: number;

  // Customer actions
  updateCustomerProfile: (updates: { fullName: string; phone?: string; preferredLanguage: string }) => ActionResult;
  toggleTwoFactor: (enabled: boolean) => ActionResult;
  submitKyc: (payload: {
    fullName: string;
    country: string;
    documentType: 'National ID' | 'Passport' | 'Driver License';
    documentNumber: string;
  }) => ActionResult;
  requestDepositAddress: (payload: { assetSymbol: string; networkCode: string }) => Promise<ActionResult>;
  requestWithdrawal: (input: WithdrawalRequestInput) => ActionResult;
  cancelWithdrawal: (withdrawalId: string) => ActionResult;
  submitSpotOrder: (input: SpotTradeInput) => Promise<ActionResult>;
  markNotificationRead: (notificationId: string) => void;
  markAllNotificationsRead: () => void;

  // Admin actions
  toggleCustomerAccountStatus: (customerUserId: string, nextStatus: AccountStatus, reason: string) => ActionResult;
  reviewKyc: (submissionId: string, decision: 'approved' | 'rejected', rejectionReason?: string) => ActionResult;
  reviewDeposit: (depositId: string, decision: 'approved' | 'rejected', adminNote: string) => ActionResult;
  reviewWithdrawal: (withdrawalId: string, decision: 'approved' | 'rejected', note: string) => ActionResult;
  dispatchApprovedWithdrawal: (withdrawalId: string) => Promise<ActionResult>;
  finalizeWithdrawalRecord: (withdrawalId: string) => ActionResult;
  refundFailedWithdrawal: (withdrawalId: string, reason: string) => ActionResult;
  updateNetworkConfig: (
    networkId: string,
    updates: {
      requiredConfirmations: number;
      minDeposit: number;
      minWithdrawal: number;
      networkFee: number;
      platformFee: number;
      isDepositEnabled: boolean;
      isWithdrawalEnabled: boolean;
    }
  ) => ActionResult;
  createLedgerAdjustment: (input: LedgerAdjustmentInput) => ActionResult;
  updateAsset: (assetId: string, updates: { isEnabled: boolean; name: string; description: string }) => ActionResult;
  updateTradingPair: (pairId: string, updates: { isEnabled: boolean; feeRate: number; minOrderUsdt: number }) => ActionResult;
  updateMarketSettings: (updates: { providerStatus: MarketDataStatus; refreshIntervalSeconds: number }) => ActionResult;
  sendNotificationCampaign: (input: SendCampaignInput) => ActionResult;
  updateAdminRole: (userId: string, nextRole: AppRole) => ActionResult;
  runBalanceReconciliation: () => ActionResult;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

export const AppStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem('app_theme');
      return saved === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const [language, setLanguageState] = useState<string>('English');
  const [hideBalances, setHideBalances] = useState<boolean>(false);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [profiles, setProfiles] = useState<Profile[]>(INITIAL_PROFILES);
  const [userRoles, setUserRoles] = useState<UserRoleRecord[]>(INITIAL_USER_ROLES);
  const [assets, setAssets] = useState<Asset[]>(INITIAL_ASSETS);
  const [networks, setNetworks] = useState<NetworkConfig[]>(INITIAL_NETWORKS);
  const [tradingPairs, setTradingPairs] = useState<TradingPair[]>(INITIAL_TRADING_PAIRS);
  const [marketPrices, setMarketPrices] = useState<MarketPrice[]>(INITIAL_MARKET_PRICES);
  const [marketSettings, setMarketSettings] = useState<MarketSettings>(INITIAL_MARKET_SETTINGS);
  const [marketLoading, setMarketLoading] = useState<boolean>(true);
  const [marketFeedIsCached, setMarketFeedIsCached] = useState<boolean>(false);
  const [marketFeedError, setMarketFeedError] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    try {
      return parseStoredWatchlist(localStorage.getItem(WATCHLIST_STORAGE_KEY));
    } catch {
      return parseStoredWatchlist(null);
    }
  });
  const [providerHealth] = useState<ProviderHealth[]>(INITIAL_PROVIDER_HEALTH);
  const [reconciliationRuns, setReconciliationRuns] = useState<ReconciliationRun[]>(
    INITIAL_RECONCILIATION_RUNS
  );
  const [walletBalances, setWalletBalances] = useState<WalletBalance[]>(INITIAL_WALLET_BALANCES);
  const [depositAddresses] = useState<DepositAddress[]>(INITIAL_DEPOSIT_ADDRESSES);
  const [deposits, setDeposits] = useState<DepositRecord[]>(INITIAL_DEPOSITS);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>(INITIAL_WITHDRAWALS);
  const [kycSubmissions, setKycSubmissions] = useState<KycSubmission[]>(INITIAL_KYC_SUBMISSIONS);
  const [spotOrders, setSpotOrders] = useState<SpotOrder[]>(INITIAL_SPOT_ORDERS);
  const [trades] = useState<Trade[]>(INITIAL_TRADES);
  const [ledgerTransactions, setLedgerTransactions] = useState<LedgerTransaction[]>(
    INITIAL_LEDGER_TRANSACTIONS
  );
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>(INITIAL_LEDGER_ENTRIES);
  const [notificationCampaigns, setNotificationCampaigns] = useState<NotificationCampaign[]>(
    INITIAL_NOTIFICATION_CAMPAIGNS
  );
  const [notifications, setNotifications] = useState<NotificationItem[]>(INITIAL_NOTIFICATIONS);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>(INITIAL_AUDIT_LOGS);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('app_theme', theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  const toggleHideBalances = () => setHideBalances((prev) => !prev);

  useEffect(() => {
    try {
      localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(watchlist));
    } catch {
      // ignore storage errors
    }
  }, [watchlist]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === WATCHLIST_STORAGE_KEY) {
        setWatchlist(parseStoredWatchlist(e.newValue));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggleWatchlist = (symbol: string) => {
    setWatchlist((prev) => toggleWatchlistSymbol(prev, symbol));
  };

  const isWatchlisted = (symbol: string) => watchlist.includes(symbol.trim().toUpperCase());

  const setLanguage = (lang: string) => {
    setLanguageState(lang);
    if (currentUserId) {
      setProfiles((prev) =>
        prev.map((p) => (p.id === currentUserId ? { ...p, preferredLanguage: lang } : p))
      );
    }
  };

  const currentProfile = useMemo(
    () => profiles.find((p) => p.id === currentUserId) ?? null,
    [profiles, currentUserId]
  );

  const currentRole = useMemo<AppRole>(() => {
    if (!currentUserId) return 'customer';
    return userRoles.find((r) => r.userId === currentUserId)?.role ?? 'customer';
  }, [userRoles, currentUserId]);

  const isAdmin =
    currentRole === 'super_admin' ||
    currentRole === 'operations_admin' ||
    currentRole === 'finance_admin' ||
    currentRole === 'compliance_admin';

  const customerProfiles = useMemo(() => {
    const adminIds = new Set(
      userRoles.filter((r) => r.role !== 'customer').map((r) => r.userId)
    );
    return profiles.filter((p) => !adminIds.has(p.id));
  }, [profiles, userRoles]);

  const appendAudit = (params: {
    action: string;
    affectedUserId: string | null;
    recordType: string;
    recordId: string;
    details: string;
  }) => {
    const actor = currentProfile;
    const actorRole = exchangeService.getRoleLabel(currentRole);
    const affected = params.affectedUserId
      ? profiles.find((p) => p.id === params.affectedUserId)
      : null;
    const entry: AdminAuditLog = {
      id: exchangeService.generateId('aud'),
      adminUserId: actor?.id ?? 'system',
      adminLabel: `${actor?.fullName ?? 'System'} (${actorRole})`,
      action: params.action,
      affectedUserId: params.affectedUserId,
      affectedPublicUserId: affected?.publicUserId ?? null,
      recordType: params.recordType,
      recordId: params.recordId,
      details: params.details,
      createdAt: new Date().toISOString(),
    };
    setAuditLogs((prev) => [entry, ...prev]);
  };

  const hydrateAuthenticatedSnapshot = (snapshot: {
    profile: Profile;
    role: AppRole;
    balances?: WalletBalance[];
  }) => {
    setProfiles((prev) => {
      const exists = prev.some((p) => p.id === snapshot.profile.id);
      return exists
        ? prev.map((p) => (p.id === snapshot.profile.id ? snapshot.profile : p))
        : [snapshot.profile, ...prev];
    });

    setUserRoles((prev) => {
      const filtered = prev.filter((r) => r.userId !== snapshot.profile.id);
      return [
        ...filtered,
        {
          id: `role-${snapshot.profile.id}`,
          userId: snapshot.profile.id,
          role: snapshot.role,
          assignedBy: 'database',
          createdAt: snapshot.profile.createdAt,
        },
      ];
    });

    if (Array.isArray(snapshot.balances)) {
      setWalletBalances((prev) => {
        const others = prev.filter((b) => b.userId !== snapshot.profile.id);
        return [...others, ...snapshot.balances!];
      });
    }

    setCurrentUserId(snapshot.profile.id);
    setLanguageState(snapshot.profile.preferredLanguage);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/auth/session', { credentials: 'include' });
        if (!res.ok) return;
        const json = await res.json();
        if (active && json?.ok && json?.authenticated && json?.data?.profile) {
          hydrateAuthenticatedSnapshot(json.data);
        }
      } catch {
        // Ignore network failure during unauthenticated startup
      } finally {
        if (active) setAuthLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const syncMarketTickers = async (isActiveCheck?: () => boolean) => {
    const canUpdate = () => (isActiveCheck ? isActiveCheck() : true);
    try {
      const res = await fetch('/api/markets/tickers');
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        data?: {
          providerName?: string;
          dataStatus?: MarketDataStatus;
          syncedAt?: string;
          isCached?: boolean;
          tickers?: Array<{
            symbol: string;
            price: number;
            change24hPct: number;
            high24h: number;
            low24h: number;
            volume24h: number;
            dataStatus: MarketDataStatus;
            updatedAt: string;
          }>;
        };
      } | null;

      if (!canUpdate()) return;

      if (!res.ok || !json?.ok || !Array.isArray(json?.data?.tickers)) {
        const errMsg = json?.message || `Market feed unavailable (HTTP ${res.status}).`;
        setMarketFeedError(errMsg);
        setMarketPrices((prev) => {
          const hasAnyCached = prev.some((m) => m.price > 0);
          setMarketFeedIsCached(hasAnyCached);
          if (!hasAnyCached) {
            setMarketSettings((s) => ({ ...s, providerStatus: 'unavailable' }));
          }
          return prev;
        });
        return;
      }

      const incomingTickers = json.data.tickers;
      const incomingMap = new Map(incomingTickers.map((t) => [t.symbol, t]));
      const fromServerCache = Boolean(json.data.isCached);

      setMarketPrices((prev) =>
        prev.map((mp) => {
          const fresh = incomingMap.get(mp.symbol);
          if (!fresh || fresh.price <= 0) return mp;
          return {
            ...mp,
            price: fresh.price,
            change24hPct: fresh.change24hPct,
            high24h: fresh.high24h,
            low24h: fresh.low24h,
            volume24h: fresh.volume24h,
            dataStatus: fresh.dataStatus,
            updatedAt: fresh.updatedAt,
          };
        })
      );

      setMarketFeedIsCached(fromServerCache);
      setMarketFeedError(null);
      setMarketSettings((prev) => ({
        ...prev,
        providerName: json.data?.providerName || 'Spot Market Feed',
        providerStatus: json.data?.dataStatus === 'live' ? 'live' : prev.providerStatus,
        lastSyncedAt: json.data?.syncedAt || new Date().toISOString(),
      }));
    } catch {
      if (!canUpdate()) return;
      setMarketFeedError('Unable to reach live market ticker endpoint.');
      setMarketPrices((prev) => {
        const hasAnyCached = prev.some((m) => m.price > 0);
        setMarketFeedIsCached(hasAnyCached);
        if (!hasAnyCached) {
          setMarketSettings((s) => ({ ...s, providerStatus: 'unavailable' }));
        }
        return prev;
      });
    } finally {
      if (canUpdate()) {
        setMarketLoading(false);
      }
    }
  };

  const refreshMarketTickers = async () => {
    setMarketLoading(true);
    await syncMarketTickers();
  };

  useEffect(() => {
    let active = true;
    void syncMarketTickers(() => active);
    const timer = window.setInterval(() => {
      void syncMarketTickers(() => active);
    }, 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const login = async (
    identifier: string,
    password: string
  ): Promise<ActionResult & { role?: AppRole }> => {
    if (!identifier.trim() || !password) {
      return {
        ok: false,
        message: 'Please enter your email, phone, or User ID and password.',
      };
    }

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok || !json?.data?.profile) {
        return {
          ok: false,
          message: json?.message || 'Unable to sign in with the provided credentials.',
        };
      }
      hydrateAuthenticatedSnapshot(json.data);
      return {
        ok: true,
        message: json.message || 'Signed in successfully.',
        role: json.data.role,
      };
    } catch {
      return {
        ok: false,
        message: 'Authentication service is unreachable.',
      };
    }
  };

  const register = async (input: RegisterInput): Promise<ActionResult> => {
    const email = input.email.trim().toLowerCase();
    const rawPhone = typeof input.phone === 'string' ? input.phone.trim() : '';
    if (!input.fullName.trim() || !email || input.password.length < 8) {
      return {
        ok: false,
        message: 'Full name, email, and password (min 8 characters) are required.',
      };
    }

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          fullName: input.fullName.trim(),
          email,
          phone: rawPhone || undefined,
          password: input.password,
          preferredLanguage: input.preferredLanguage || 'English',
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok || !json?.data?.profile) {
        return {
          ok: false,
          message: json?.message || 'Unable to register account.',
        };
      }
      hydrateAuthenticatedSnapshot(json.data);
      return {
        ok: true,
        message: json.message || 'Account created with 0.00 starting balances.',
      };
    } catch {
      return {
        ok: false,
        message: 'Registration service is unreachable.',
      };
    }
  };

  const logout = async (): Promise<void> => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Clear local session state regardless of network status
    }
    setCurrentUserId(null);
  };

  const recoverPassword = async (identifier: string): Promise<ActionResult> => {
    if (!identifier.trim()) {
      return { ok: false, message: 'Enter your account email, phone, or User ID.' };
    }
    try {
      const res = await fetch('/api/auth/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim() }),
      });
      const json = await res.json();
      return {
        ok: Boolean(res.ok && json?.ok),
        message:
          json?.message ||
          'Unable to process password recovery request.',
      };
    } catch {
      return {
        ok: false,
        message: 'Password recovery service is unreachable.',
      };
    }
  };

  const updatePassword = async (
    currentPassword: string,
    newPassword: string
  ): Promise<ActionResult> => {
    if (!currentPassword || newPassword.length < 8) {
      return {
        ok: false,
        message: 'Enter your current password and a new password (min 8 characters).',
      };
    }
    try {
      const res = await fetch('/api/auth/update-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await res.json();
      return {
        ok: Boolean(res.ok && json?.ok),
        message: json?.message || 'Unable to update password.',
      };
    } catch {
      return {
        ok: false,
        message: 'Password update service is unreachable.',
      };
    }
  };

  const currentUserBalances = useMemo(
    () => walletBalances.filter((b) => b.userId === currentUserId),
    [walletBalances, currentUserId]
  );

  const currentUserKyc = useMemo(() => {
    const list = kycSubmissions
      .filter((k) => k.userId === currentUserId)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    return list[0] ?? null;
  }, [kycSubmissions, currentUserId]);

  const currentUserDepositAddresses = useMemo(
    () => depositAddresses.filter((d) => d.userId === currentUserId),
    [depositAddresses, currentUserId]
  );

  const currentUserDeposits = useMemo(
    () =>
      deposits
        .filter((d) => d.userId === currentUserId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [deposits, currentUserId]
  );

  const currentUserWithdrawals = useMemo(
    () =>
      withdrawals
        .filter((w) => w.userId === currentUserId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [withdrawals, currentUserId]
  );

  const currentUserOrders = useMemo(
    () =>
      spotOrders
        .filter((o) => o.userId === currentUserId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [spotOrders, currentUserId]
  );

  const currentUserTrades = useMemo(
    () =>
      trades
        .filter((t) => t.userId === currentUserId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [trades, currentUserId]
  );

  const currentUserTransactions = useMemo(
    () =>
      ledgerTransactions
        .filter((tx) => tx.userId === currentUserId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [ledgerTransactions, currentUserId]
  );

  const currentUserNotifications = useMemo(
    () =>
      notifications
        .filter((n) => n.userId === currentUserId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [notifications, currentUserId]
  );

  const unreadNotificationsCount = useMemo(
    () => currentUserNotifications.filter((n) => !n.isRead).length,
    [currentUserNotifications]
  );

  const updateCustomerProfile = (updates: {
    fullName: string;
    phone?: string;
    preferredLanguage: string;
  }): ActionResult => {
    if (!currentProfile) return { ok: false, message: 'Authentication required.' };
    if (!updates.fullName.trim()) {
      return { ok: false, message: 'Full name cannot be empty.' };
    }
    const cleanPhone = typeof updates.phone === 'string' ? updates.phone.replace(/[\s().-]+/g, '').trim() : '';
    if (cleanPhone && !/^\+[1-9][0-9]{6,14}$/.test(cleanPhone)) {
      return { ok: false, message: 'Phone number must be in international E.164 format (e.g. +15550102030).' };
    }
    setProfiles((prev) =>
      prev.map((p) =>
        p.id === currentProfile.id
          ? {
              ...p,
              fullName: updates.fullName.trim(),
              phone: cleanPhone || null,
              preferredLanguage: updates.preferredLanguage,
            }
          : p
      )
    );
    setLanguageState(updates.preferredLanguage);
    return { ok: true, message: 'Profile details updated.' };
  };

  const toggleTwoFactor = (enabled: boolean): ActionResult => {
    if (!currentProfile) return { ok: false, message: 'Authentication required.' };
    setProfiles((prev) =>
      prev.map((p) => (p.id === currentProfile.id ? { ...p, twoFactorEnabled: enabled } : p))
    );
    return {
      ok: true,
      message: enabled
        ? 'Two-Factor Authentication (2FA) enabled for withdrawals and security actions.'
        : 'Two-Factor Authentication disabled.',
    };
  };

  const submitKyc = (payload: {
    fullName: string;
    country: string;
    documentType: 'National ID' | 'Passport' | 'Driver License';
    documentNumber: string;
  }): ActionResult => {
    if (!currentProfile) return { ok: false, message: 'Please sign in first.' };
    if (!payload.fullName.trim() || !payload.country.trim() || !payload.documentNumber.trim()) {
      return { ok: false, message: 'All identity verification fields are required.' };
    }
    const now = new Date().toISOString();
    const submission: KycSubmission = {
      id: exchangeService.generateId('kyc'),
      userId: currentProfile.id,
      providerName: 'Compliance Screening Queue (Phase C IDV Pending)',
      sanctionsStatus: 'pending',
      livenessPassed: false,
      fullName: payload.fullName.trim(),
      country: payload.country.trim(),
      documentType: payload.documentType,
      documentNumber: payload.documentNumber.trim(),
      submittedAt: now,
      status: 'pending',
      rejectionReason: null,
      reviewedBy: null,
      reviewedAt: null,
    };
    setKycSubmissions((prev) => [submission, ...prev]);
    setProfiles((prev) =>
      prev.map((p) => (p.id === currentProfile.id ? { ...p, kycStatus: 'pending' } : p))
    );
    return { ok: true, message: 'KYC submission queued for compliance review.' };
  };

  const requestDepositAddress = async (payload: {
    assetSymbol: string;
    networkCode: string;
  }): Promise<ActionResult> => {
    if (!currentProfile) return { ok: false, message: 'Please sign in first.' };
    if (currentProfile.accountStatus !== 'active') {
      return {
        ok: false,
        message:
          currentProfile.accountStatus === 'closed'
            ? 'Account is closed. Deposits are disabled.'
            : 'Account is suspended. Deposits are disabled.',
      };
    }
    if (currentProfile.kycStatus !== 'approved') {
      return { ok: false, message: 'Approved KYC verification is required before generating deposit addresses.' };
    }
    const existing = depositAddresses.find(
      (d) =>
        d.userId === currentProfile.id &&
        d.assetSymbol === payload.assetSymbol &&
        d.networkCode === payload.networkCode
    );
    if (existing) {
      return { ok: true, message: 'Deposit address ready.' };
    }

    const res = await unconfiguredCustodyProvider.getOrCreateDepositAddress({
      userId: currentProfile.id,
      assetSymbol: payload.assetSymbol,
      networkCode: payload.networkCode,
    });
    return { ok: res.ok, message: res.message };
  };

  const requestWithdrawal = (input: WithdrawalRequestInput): ActionResult => {
    if (!currentProfile) return { ok: false, message: 'Please sign in first.' };
    const net = networks.find(
      (n) => n.assetSymbol === input.assetSymbol && n.code === input.networkCode
    );
    const bal = walletBalances.find(
      (b) => b.userId === currentProfile.id && b.assetSymbol === input.assetSymbol
    );
    const available = bal?.available ?? 0;
    const market = marketPrices.find((m) => m.symbol === `${input.assetSymbol}/USDT`);
    const quote = previewWithdrawal({
      accountStatus: currentProfile.accountStatus,
      kycStatus: currentProfile.kycStatus,
      twoFactorEnabled: currentProfile.twoFactorEnabled,
      twoFactorCode: input.twoFactorCode,
      network: net,
      destinationAddress: input.destinationAddress,
      memoOrTag: input.memoOrTag,
      grossAmount: input.grossAmount,
      availableBalance: available,
      estimatedUsdtPrice: input.assetSymbol === 'USDT' ? 1 : (market?.price ?? 0),
    });

    if (!quote.valid || !net || !bal) {
      return { ok: false, message: quote.error ?? 'Withdrawal validation failed.' };
    }

    const now = new Date().toISOString();
    const wdId = exchangeService.generateId('wd');
    const txId = exchangeService.generateId('ltx');
    const nextAvailable = roundAmount(bal.available - quote.grossAmount, 8);
    const nextReserved = roundAmount(bal.reserved + quote.grossAmount, 8);

    const reqItem: WithdrawalRequest = {
      id: wdId,
      userId: currentProfile.id,
      assetSymbol: input.assetSymbol,
      networkCode: input.networkCode,
      destinationAddress: input.destinationAddress.trim(),
      memoOrTag: input.memoOrTag?.trim() || null,
      grossAmount: quote.grossAmount,
      networkFee: quote.networkFee,
      platformFee: quote.platformFee,
      netAmount: quote.netReceived,
      twoFactorVerified: true,
      riskLevel: quote.riskLevel,
      kytStatus: 'pending',
      requiredApprovals: quote.requiredApprovals,
      approvals: [],
      custodyTxId: null,
      txHash: null,
      confirmations: 0,
      requiredConfirmations: net.requiredConfirmations,
      status: 'PENDING_ADMIN_APPROVAL',
      failureReason: null,
      rejectionReason: null,
      idempotencyKey: `wd-${wdId}`,
      createdAt: now,
      updatedAt: now,
    };

    setWalletBalances((prev) =>
      prev.map((b) =>
        b.id === bal.id
          ? { ...b, available: nextAvailable, reserved: nextReserved, updatedAt: now }
          : b
      )
    );
    setWithdrawals((prev) => [reqItem, ...prev]);
    setLedgerTransactions((prev) => [
      {
        id: txId,
        userId: currentProfile.id,
        type: 'withdrawal_reserve',
        referenceId: wdId,
        idempotencyKey: `wd-reserve-${wdId}`,
        sourceAccount: 'customer_available',
        reasonCode: 'WITHDRAWAL_REQUESTED',
        reversalOfTxId: null,
        summary: `Reserved ${quote.grossAmount} ${input.assetSymbol} for withdrawal (${input.networkCode})`,
        createdAt: now,
      },
      ...prev,
    ]);
    setLedgerEntries((prev) => [
      {
        id: exchangeService.generateId('le'),
        transactionId: txId,
        userId: currentProfile.id,
        assetSymbol: input.assetSymbol,
        bucket: 'available',
        deltaAmount: -quote.grossAmount,
        balanceAfter: nextAvailable,
        entryRole: 'reserve_available_for_withdrawal',
        createdAt: now,
      },
      {
        id: exchangeService.generateId('le'),
        transactionId: txId,
        userId: currentProfile.id,
        assetSymbol: input.assetSymbol,
        bucket: 'reserved',
        deltaAmount: quote.grossAmount,
        balanceAfter: nextReserved,
        entryRole: 'lock_withdrawal_reserve',
        createdAt: now,
      },
      ...prev,
    ]);

    return {
      ok: true,
      message: `Withdrawal request submitted (${quote.requiredApprovals === 2 ? 'Dual-admin' : 'Admin'} approval required). Funds moved to reserved balance.`,
    };
  };

  const cancelWithdrawal = (withdrawalId: string): ActionResult => {
    if (!currentProfile) return { ok: false, message: 'Authentication required.' };
    const wd = withdrawals.find((w) => w.id === withdrawalId && w.userId === currentProfile.id);
    if (!wd) return { ok: false, message: 'Withdrawal record not found.' };
    if (wd.status !== 'REQUESTED' && wd.status !== 'RISK_REVIEW' && wd.status !== 'PENDING_ADMIN_APPROVAL') {
      return { ok: false, message: `Withdrawal cannot be cancelled in status ${wd.status}.` };
    }
    const now = new Date().toISOString();
    const res = refundReservedWithdrawal({
      withdrawal: wd,
      targetStatus: 'CANCELLED',
      reason: 'Cancelled by customer prior to approval',
      balances: walletBalances,
      txId: exchangeService.generateId('ltx'),
      releaseEntryId: exchangeService.generateId('le'),
      creditEntryId: exchangeService.generateId('le'),
      nowIso: now,
    });
    if (!res.ok || !res.data) return { ok: false, message: res.error ?? 'Unable to cancel withdrawal.' };

    setWithdrawals((prev) => prev.map((w) => (w.id === wd.id ? res.data!.updatedWithdrawal : w)));
    setWalletBalances(res.data.updatedBalances);
    setLedgerTransactions((prev) => [res.data!.newTransaction, ...prev]);
    setLedgerEntries((prev) => [...res.data!.newEntries, ...prev]);
    return { ok: true, message: 'Withdrawal cancelled and reserved funds restored to available balance.' };
  };

  const submitSpotOrder = async (input: SpotTradeInput): Promise<ActionResult> => {
    if (!currentProfile) return { ok: false, message: 'Please sign in first.' };
    const pair = tradingPairs.find((p) => p.symbol === input.pairSymbol);
    if (!pair) return { ok: false, message: 'Selected trading pair not found.' };

    const baseAssetMeta = assets.find((a) => a.symbol === pair.baseAsset);
    const quoteAssetMeta = assets.find((a) => a.symbol === pair.quoteAsset);
    const market = marketPrices.find((m) => m.symbol === pair.symbol);
    if (!market) return { ok: false, message: 'Market price quote unavailable.' };

    const effectiveOrderType: 'MARKET' | 'LIMIT' = input.orderType === 'LIMIT' ? 'LIMIT' : 'MARKET';
    const effectivePrice =
      effectiveOrderType === 'LIMIT'
        ? Number(input.limitPrice ?? 0)
        : market.price;

    if (effectiveOrderType === 'LIMIT' && (!Number.isFinite(effectivePrice) || effectivePrice <= 0)) {
      return { ok: false, message: 'Enter a valid positive limit price.' };
    }

    const usdtBal =
      walletBalances.find((b) => b.userId === currentProfile.id && b.assetSymbol === 'USDT')
        ?.available ?? 0;
    const baseBal =
      walletBalances.find(
        (b) => b.userId === currentProfile.id && b.assetSymbol === pair.baseAsset
      )?.available ?? 0;

    const preview =
      input.side === 'buy'
        ? calculateSpotBuyPreview({
            usdtAmount: input.amountInput,
            executionPrice: effectivePrice,
            feeRate: pair.feeRate,
            availableUsdt: usdtBal,
            minOrderUsdt: pair.minOrderUsdt,
            dataStatus: marketSettings.providerStatus,
            kycStatus: currentProfile.kycStatus,
            accountStatus: currentProfile.accountStatus,
            pairEnabled: pair.isEnabled,
            assetEnabled: Boolean(baseAssetMeta?.isEnabled && quoteAssetMeta?.isEnabled),
          })
        : calculateSpotSellPreview({
            baseQuantity: input.amountInput,
            executionPrice: effectivePrice,
            feeRate: pair.feeRate,
            availableBase: baseBal,
            minOrderUsdt: pair.minOrderUsdt,
            dataStatus: marketSettings.providerStatus,
            kycStatus: currentProfile.kycStatus,
            accountStatus: currentProfile.accountStatus,
            pairEnabled: pair.isEnabled,
            assetEnabled: Boolean(baseAssetMeta?.isEnabled && quoteAssetMeta?.isEnabled),
          });

    if (!preview.valid) {
      return { ok: false, message: preview.error ?? 'Order validation failed.' };
    }

    const venueResult = await unconfiguredLiquidityProvider.submitMarketOrder({
      clientOrderId: exchangeService.generateId('ord'),
      venueSymbol: pair.venueSymbol,
      side: input.side,
      requestedAmount: input.amountInput,
    });

    if (!venueResult.ok) {
      const now = new Date().toISOString();
      const rejectedOrder: SpotOrder = {
        id: exchangeService.generateId('ord'),
        userId: currentProfile.id,
        pairSymbol: pair.symbol,
        side: input.side,
        orderType: effectiveOrderType,
        limitPrice: effectiveOrderType === 'LIMIT' ? effectivePrice : null,
        requestedAmount: input.amountInput,
        reservedAsset: input.side === 'buy' ? 'USDT' : pair.baseAsset,
        reservedAmount: 0,
        filledBaseQty: 0,
        filledQuoteAmount: 0,
        feeUsdt: 0,
        venueName: unconfiguredLiquidityProvider.providerName,
        venueOrderId: null,
        status: 'REJECTED',
        rejectReason: venueResult.message,
        idempotencyKey: `ord-rej-${Date.now()}`,
        createdAt: now,
        updatedAt: now,
      };
      setSpotOrders((prev) => [rejectedOrder, ...prev]);
      return { ok: false, message: venueResult.message };
    }

    return { ok: true, message: 'Order submitted to liquidity venue.' };
  };

  const markNotificationRead = (notificationId: string) => {
    const now = new Date().toISOString();
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId && !n.isRead ? { ...n, isRead: true, readAt: now } : n))
    );
  };

  const markAllNotificationsRead = () => {
    if (!currentUserId) return;
    const now = new Date().toISOString();
    setNotifications((prev) =>
      prev.map((n) =>
        n.userId === currentUserId && !n.isRead ? { ...n, isRead: true, readAt: now } : n
      )
    );
  };

  // Admin Operations
  const toggleCustomerAccountStatus = (
    customerUserId: string,
    nextStatus: AccountStatus,
    reason: string
  ): ActionResult => {
    if (!isAdmin) return { ok: false, message: 'Admin permission required.' };
    setProfiles((prev) =>
      prev.map((p) => (p.id === customerUserId ? { ...p, accountStatus: nextStatus } : p))
    );
    appendAudit({
      action: nextStatus === 'suspended' ? 'CUSTOMER_SUSPENDED' : 'CUSTOMER_REACTIVATED',
      affectedUserId: customerUserId,
      recordType: 'profiles',
      recordId: customerUserId,
      details: `${nextStatus === 'suspended' ? 'Suspended' : 'Reactivated'} account. Note: ${reason || 'Administrative review'}`,
    });
    return {
      ok: true,
      message: `Customer account marked as ${nextStatus}.`,
    };
  };

  const reviewKyc = (
    submissionId: string,
    decision: 'approved' | 'rejected',
    rejectionReason?: string
  ): ActionResult => {
    if (!isAdmin) return { ok: false, message: 'Admin permission required.' };
    const target = kycSubmissions.find((k) => k.id === submissionId);
    if (!target) return { ok: false, message: 'KYC submission not found.' };
    if (decision === 'rejected' && !rejectionReason?.trim()) {
      return { ok: false, message: 'Provide a rejection reason before rejecting KYC.' };
    }
    const now = new Date().toISOString();
    setKycSubmissions((prev) =>
      prev.map((k) =>
        k.id === submissionId
          ? {
              ...k,
              status: decision,
              sanctionsStatus: decision === 'approved' ? 'clear' : k.sanctionsStatus,
              livenessPassed: decision === 'approved' ? true : k.livenessPassed,
              rejectionReason: decision === 'rejected' ? rejectionReason!.trim() : null,
              reviewedBy: currentUserId,
              reviewedAt: now,
            }
          : k
      )
    );
    setProfiles((prev) =>
      prev.map((p) => (p.id === target.userId ? { ...p, kycStatus: decision } : p))
    );
    appendAudit({
      action: decision === 'approved' ? 'KYC_APPROVED' : 'KYC_REJECTED',
      affectedUserId: target.userId,
      recordType: 'kyc_submissions',
      recordId: submissionId,
      details:
        decision === 'approved'
          ? 'Approved customer KYC & sanctions verification.'
          : `Rejected KYC verification: ${rejectionReason?.trim()}`,
    });
    return { ok: true, message: `KYC submission ${decision}.` };
  };

  const reviewDeposit = (
    depositId: string,
    decision: 'approved' | 'rejected',
    adminNote: string
  ): ActionResult => {
    if (!isAdmin || !currentUserId) return { ok: false, message: 'Admin permission required.' };
    const target = deposits.find((d) => d.id === depositId);
    if (!target) return { ok: false, message: 'Deposit record not found.' };
    const now = new Date().toISOString();

    if (decision === 'rejected') {
      if (target.status === 'CREDITED' || target.status === 'REJECTED') {
        return { ok: false, message: 'This deposit has already reached a terminal state.' };
      }
      setDeposits((prev) =>
        prev.map((d) =>
          d.id === depositId
            ? {
                ...d,
                status: 'REJECTED',
                adminNote: adminNote.trim() || 'Rejected by administrator',
                reviewedBy: currentUserId,
                reviewedAt: now,
                updatedAt: now,
              }
            : d
        )
      );
      appendAudit({
        action: 'DEPOSIT_REJECTED',
        affectedUserId: target.userId,
        recordType: 'deposits',
        recordId: depositId,
        details: `Rejected deposit ${target.amount} ${target.assetSymbol} (${target.networkCode}). ${adminNote}`,
      });
      return { ok: true, message: 'Deposit rejected.' };
    }

    const applied = applyDepositApproval({
      deposit: target,
      existingDeposits: deposits,
      balances: walletBalances,
      ledgerTransactions,
      adminUserId: currentUserId,
      adminNote,
      nowIso: now,
      txId: exchangeService.generateId('ltx'),
      entryId: exchangeService.generateId('le'),
      balanceId: exchangeService.generateId('bal'),
    });

    if (!applied.ok || !applied.data) {
      return { ok: false, message: applied.error ?? 'Deposit verification failed.' };
    }

    setDeposits((prev) =>
      prev.map((d) => (d.id === depositId ? applied.data!.updatedDeposit : d))
    );
    setWalletBalances(applied.data.updatedBalances);
    setLedgerTransactions((prev) => [applied.data!.newTransaction, ...prev]);
    setLedgerEntries((prev) => [applied.data!.newEntry, ...prev]);

    appendAudit({
      action: 'DEPOSIT_VERIFIED_AND_CREDITED',
      affectedUserId: target.userId,
      recordType: 'deposits',
      recordId: depositId,
      details: `Approved & credited verified deposit of ${target.amount} ${target.assetSymbol} (${target.networkCode}, tx ${target.txHash}).`,
    });

    return { ok: true, message: 'Verified deposit approved and credited once to ledger.' };
  };

  const reviewWithdrawal = (
    withdrawalId: string,
    decision: 'approved' | 'rejected',
    note: string
  ): ActionResult => {
    if (!isAdmin || !currentUserId || !currentProfile) {
      return { ok: false, message: 'Admin permission required.' };
    }
    const target = withdrawals.find((w) => w.id === withdrawalId);
    if (!target) return { ok: false, message: 'Withdrawal record not found.' };
    const now = new Date().toISOString();

    const res = applyWithdrawalApprovalDecision({
      withdrawal: target,
      adminUserId: currentUserId,
      adminLabel: currentProfile.fullName,
      adminRole: currentRole,
      decision,
      note,
      nowIso: now,
    });

    if (!res.ok || !res.data) {
      return { ok: false, message: res.error ?? 'Unable to record withdrawal decision.' };
    }

    if (decision === 'rejected') {
      const refunded = refundReservedWithdrawal({
        withdrawal: res.data,
        targetStatus: 'REJECTED',
        reason: note.trim(),
        balances: walletBalances,
        txId: exchangeService.generateId('ltx'),
        releaseEntryId: exchangeService.generateId('le'),
        creditEntryId: exchangeService.generateId('le'),
        nowIso: now,
      });
      if (!refunded.ok || !refunded.data) {
        return { ok: false, message: refunded.error ?? 'Failed to release reserved balance.' };
      }
      setWithdrawals((prev) =>
        prev.map((w) => (w.id === withdrawalId ? refunded.data!.updatedWithdrawal : w))
      );
      setWalletBalances(refunded.data.updatedBalances);
      setLedgerTransactions((prev) => [refunded.data!.newTransaction, ...prev]);
      setLedgerEntries((prev) => [...refunded.data!.newEntries, ...prev]);
      appendAudit({
        action: 'WITHDRAWAL_REJECTED',
        affectedUserId: target.userId,
        recordType: 'withdrawals',
        recordId: withdrawalId,
        details: `Rejected withdrawal of ${target.grossAmount} ${target.assetSymbol}. Reason: ${note}`,
      });
      return { ok: true, message: 'Withdrawal rejected and reserved funds returned to available balance.' };
    }

    setWithdrawals((prev) => prev.map((w) => (w.id === withdrawalId ? res.data! : w)));
    appendAudit({
      action:
        res.data.status === 'APPROVED'
          ? 'WITHDRAWAL_APPROVED'
          : 'WITHDRAWAL_PARTIAL_APPROVAL',
      affectedUserId: target.userId,
      recordType: 'withdrawals',
      recordId: withdrawalId,
      details: `Recorded approval for ${target.grossAmount} ${target.assetSymbol} withdrawal (status: ${res.data.status}).`,
    });
    return {
      ok: true,
      message:
        res.data.status === 'APPROVED'
          ? 'Withdrawal approved and queued for custody broadcast.'
          : 'First approval recorded. Second distinct administrator approval required.',
    };
  };

  const dispatchApprovedWithdrawal = async (withdrawalId: string): Promise<ActionResult> => {
    if (!isAdmin) return { ok: false, message: 'Admin permission required.' };
    const target = withdrawals.find((w) => w.id === withdrawalId);
    if (!target) return { ok: false, message: 'Withdrawal not found.' };
    if (target.status !== 'APPROVED') {
      return { ok: false, message: 'Withdrawal must be APPROVED before custody dispatch.' };
    }

    const res = await unconfiguredCustodyProvider.submitWithdrawal({
      withdrawalId: target.id,
      assetSymbol: target.assetSymbol,
      networkCode: target.networkCode,
      destinationAddress: target.destinationAddress,
      memoOrTag: target.memoOrTag,
      netAmount: target.netAmount,
      idempotencyKey: target.idempotencyKey,
    });
    return { ok: res.ok, message: res.message };
  };

  const finalizeWithdrawalRecord = (withdrawalId: string): ActionResult => {
    if (!isAdmin) return { ok: false, message: 'Admin permission required.' };
    const target = withdrawals.find((w) => w.id === withdrawalId);
    if (!target) return { ok: false, message: 'Withdrawal not found.' };
    const settled = finalizeWithdrawalCompletion({
      withdrawal: target,
      balances: walletBalances,
      txId: exchangeService.generateId('ltx'),
      entryId: exchangeService.generateId('le'),
      nowIso: new Date().toISOString(),
    });
    if (!settled.ok || !settled.data) {
      return { ok: false, message: settled.error ?? 'Cannot complete withdrawal before confirmation finality.' };
    }
    setWithdrawals((prev) =>
      prev.map((w) => (w.id === withdrawalId ? settled.data!.updatedWithdrawal : w))
    );
    setWalletBalances(settled.data.updatedBalances);
    setLedgerTransactions((prev) => [settled.data!.newTransaction, ...prev]);
    setLedgerEntries((prev) => [settled.data!.newEntry, ...prev]);
    return { ok: true, message: 'Withdrawal marked COMPLETED after on-chain finality.' };
  };

  const refundFailedWithdrawal = (withdrawalId: string, reason: string): ActionResult => {
    if (!isAdmin) return { ok: false, message: 'Admin permission required.' };
    const target = withdrawals.find((w) => w.id === withdrawalId);
    if (!target) return { ok: false, message: 'Withdrawal not found.' };
    if (target.status !== 'FAILED' && target.status !== 'PROCESSING' && target.status !== 'APPROVED') {
      return { ok: false, message: `Cannot refund withdrawal in status ${target.status}.` };
    }
    const res = refundReservedWithdrawal({
      withdrawal: target,
      targetStatus: 'REFUNDED',
      reason: reason.trim() || 'Failed custody broadcast refunded',
      balances: walletBalances,
      txId: exchangeService.generateId('ltx'),
      releaseEntryId: exchangeService.generateId('le'),
      creditEntryId: exchangeService.generateId('le'),
      nowIso: new Date().toISOString(),
    });
    if (!res.ok || !res.data) return { ok: false, message: res.error ?? 'Refund failed.' };
    setWithdrawals((prev) =>
      prev.map((w) => (w.id === withdrawalId ? res.data!.updatedWithdrawal : w))
    );
    setWalletBalances(res.data.updatedBalances);
    setLedgerTransactions((prev) => [res.data!.newTransaction, ...prev]);
    setLedgerEntries((prev) => [...res.data!.newEntries, ...prev]);
    appendAudit({
      action: 'WITHDRAWAL_REFUNDED',
      affectedUserId: target.userId,
      recordType: 'withdrawals',
      recordId: withdrawalId,
      details: `Refunded failed withdrawal of ${target.grossAmount} ${target.assetSymbol}. Reason: ${reason}`,
    });
    return { ok: true, message: 'Failed withdrawal refunded to customer available balance.' };
  };

  const updateNetworkConfig = (
    networkId: string,
    updates: {
      requiredConfirmations: number;
      minDeposit: number;
      minWithdrawal: number;
      networkFee: number;
      platformFee: number;
      isDepositEnabled: boolean;
      isWithdrawalEnabled: boolean;
    }
  ): ActionResult => {
    if (!isAdmin) return { ok: false, message: 'Admin permission required.' };
    if (updates.requiredConfirmations < 1 || updates.networkFee < 0 || updates.platformFee < 0) {
      return { ok: false, message: 'Confirmations must be >= 1 and fees cannot be negative.' };
    }
    const now = new Date().toISOString();
    setNetworks((prev) =>
      prev.map((n) => (n.id === networkId ? { ...n, ...updates, updatedAt: now } : n))
    );
    appendAudit({
      action: 'NETWORK_CONFIG_UPDATED',
      affectedUserId: null,
      recordType: 'networks',
      recordId: networkId,
      details: `Updated confirmations=${updates.requiredConfirmations}, netFee=${updates.networkFee}, deposit=${updates.isDepositEnabled}, withdraw=${updates.isWithdrawalEnabled}.`,
    });
    return { ok: true, message: 'Network configuration updated.' };
  };

  const createLedgerAdjustment = (input: LedgerAdjustmentInput): ActionResult => {
    if (!isAdmin) return { ok: false, message: 'Admin permission required.' };
    const customer = customerProfiles.find((p) => p.publicUserId === input.publicUserId.trim());
    if (!customer) {
      return { ok: false, message: `No customer found with Public User ID ${input.publicUserId}.` };
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      return { ok: false, message: 'Adjustment amount must be positive.' };
    }
    if (!input.reasonCode.trim() || !input.sourceAccount.trim() || !input.summaryNote.trim()) {
      return { ok: false, message: 'Source account, reason code, and summary note are required.' };
    }

    const bal = walletBalances.find(
      (b) => b.userId === customer.id && b.assetSymbol === input.assetSymbol
    );
    const currentAvail = bal?.available ?? 0;
    const delta = input.direction === 'credit' ? roundAmount(input.amount, 8) : -roundAmount(input.amount, 8);
    const nextAvail = roundAmount(currentAvail + delta, 8);
    if (nextAvail < 0) {
      return { ok: false, message: 'Debit adjustment cannot drive customer available balance below zero.' };
    }

    const now = new Date().toISOString();
    const txId = exchangeService.generateId('ltx');
    const isReversal = Boolean(input.reversalOfTxId?.trim());
    const idempotencyKey = `adj-${Date.now()}-${customer.publicUserId}`;

    setWalletBalances((prev) => {
      if (bal) {
        return prev.map((b) => (b.id === bal.id ? { ...b, available: nextAvail, updatedAt: now } : b));
      }
      return [
        ...prev,
        {
          id: exchangeService.generateId('bal'),
          userId: customer.id,
          assetSymbol: input.assetSymbol,
          available: nextAvail,
          reserved: 0,
          updatedAt: now,
        },
      ];
    });

    setLedgerTransactions((prev) => [
      {
        id: txId,
        userId: customer.id,
        type: isReversal ? 'reversal' : 'adjustment',
        referenceId: input.reversalOfTxId?.trim() || txId,
        idempotencyKey,
        sourceAccount: input.sourceAccount.trim(),
        reasonCode: input.reasonCode.trim(),
        reversalOfTxId: input.reversalOfTxId?.trim() || null,
        summary: `${isReversal ? 'Reversal' : 'Adjustment'} (${input.reasonCode}): ${input.summaryNote.trim()}`,
        createdAt: now,
      },
      ...prev,
    ]);

    setLedgerEntries((prev) => [
      {
        id: exchangeService.generateId('le'),
        transactionId: txId,
        userId: customer.id,
        assetSymbol: input.assetSymbol,
        bucket: 'available',
        deltaAmount: delta,
        balanceAfter: nextAvail,
        entryRole: input.direction === 'credit' ? 'ledger_adjustment_credit' : 'ledger_adjustment_debit',
        createdAt: now,
      },
      ...prev,
    ]);

    appendAudit({
      action: isReversal ? 'LEDGER_REVERSAL_POSTED' : 'LEDGER_ADJUSTMENT_POSTED',
      affectedUserId: customer.id,
      recordType: 'ledger_transactions',
      recordId: txId,
      details: `${input.direction.toUpperCase()} ${input.amount} ${input.assetSymbol} via ${input.sourceAccount} (${input.reasonCode}): ${input.summaryNote}`,
    });

    return {
      ok: true,
      message: `Immutable ${isReversal ? 'reversal' : 'adjustment'} entry recorded for ${customer.fullName}.`,
    };
  };

  const updateAsset = (
    assetId: string,
    updates: { isEnabled: boolean; name: string; description: string }
  ): ActionResult => {
    if (!isAdmin) return { ok: false, message: 'Admin permission required.' };
    setAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, ...updates } : a)));
    appendAudit({
      action: 'ASSET_UPDATED',
      affectedUserId: null,
      recordType: 'assets',
      recordId: assetId,
      details: `Updated asset "${updates.name}" (enabled: ${updates.isEnabled}).`,
    });
    return { ok: true, message: 'Asset configuration updated.' };
  };

  const updateTradingPair = (
    pairId: string,
    updates: { isEnabled: boolean; feeRate: number; minOrderUsdt: number }
  ): ActionResult => {
    if (!isAdmin) return { ok: false, message: 'Admin permission required.' };
    if (updates.feeRate < 0 || updates.feeRate > 0.05) {
      return { ok: false, message: 'Fee rate must be between 0% and 5%.' };
    }
    setTradingPairs((prev) => prev.map((p) => (p.id === pairId ? { ...p, ...updates } : p)));
    appendAudit({
      action: 'TRADING_PAIR_UPDATED',
      affectedUserId: null,
      recordType: 'trading_pairs',
      recordId: pairId,
      details: `Updated pair settings (enabled: ${updates.isEnabled}, fee: ${(updates.feeRate * 100).toFixed(2)}%, min: ${updates.minOrderUsdt} USDT).`,
    });
    return { ok: true, message: 'Trading pair configuration saved.' };
  };

  const updateMarketSettings = (updates: {
    providerStatus: MarketDataStatus;
    refreshIntervalSeconds: number;
  }): ActionResult => {
    if (!isAdmin) return { ok: false, message: 'Admin permission required.' };
    if (updates.providerStatus !== 'unavailable') {
      return {
        ok: false,
        message: 'Live or delayed market feeds require external provider credentials in Phase C.',
      };
    }
    const now = new Date().toISOString();
    setMarketSettings((prev) => ({
      ...prev,
      providerStatus: updates.providerStatus,
      refreshIntervalSeconds: updates.refreshIntervalSeconds,
      lastSyncedAt: now,
    }));
    setMarketPrices((prev) =>
      prev.map((m) => ({ ...m, dataStatus: updates.providerStatus, updatedAt: now }))
    );
    appendAudit({
      action: 'MARKET_SETTINGS_UPDATED',
      affectedUserId: null,
      recordType: 'market_settings',
      recordId: 'global',
      details: `Updated market settings (${updates.refreshIntervalSeconds}s refresh).`,
    });
    return { ok: true, message: 'Market settings updated.' };
  };

  const sendNotificationCampaign = (input: SendCampaignInput): ActionResult => {
    if (!isAdmin) return { ok: false, message: 'Admin permission required.' };
    if (!input.title.trim() || !input.message.trim()) {
      return { ok: false, message: 'Title and message are required.' };
    }
    if (input.recipientUserIds.length === 0) {
      return { ok: false, message: 'Select at least one recipient.' };
    }

    const now = new Date().toISOString();
    const campaignId = exchangeService.generateId('camp');
    const campaign: NotificationCampaign = {
      id: campaignId,
      title: input.title.trim(),
      message: input.message.trim(),
      category: input.category,
      recipientType: input.recipientType,
      filterSummary: input.filterSummary,
      recipientCount: input.recipientUserIds.length,
      createdBy: currentUserId ?? 'system',
      createdAt: now,
    };

    const items: NotificationItem[] = input.recipientUserIds.map((uid) => ({
      id: exchangeService.generateId('notif'),
      campaignId,
      userId: uid,
      title: campaign.title,
      message: campaign.message,
      category: campaign.category,
      isRead: false,
      readAt: null,
      createdAt: now,
    }));

    setNotificationCampaigns((prev) => [campaign, ...prev]);
    setNotifications((prev) => [...items, ...prev]);

    appendAudit({
      action: 'NOTIFICATION_CAMPAIGN_SENT',
      affectedUserId: input.recipientUserIds.length === 1 ? input.recipientUserIds[0] : null,
      recordType: 'notification_campaigns',
      recordId: campaignId,
      details: `Sent "${campaign.title}" (${campaign.recipientType}) to ${campaign.recipientCount} recipient(s).`,
    });

    return {
      ok: true,
      message: `Notification sent to ${campaign.recipientCount} recipient(s).`,
    };
  };

  const updateAdminRole = (userId: string, nextRole: AppRole): ActionResult => {
    if (currentRole !== 'super_admin') {
      return { ok: false, message: 'Only a Super Admin can modify administrator roles.' };
    }
    setUserRoles((prev) =>
      prev.map((r) =>
        r.userId === userId ? { ...r, role: nextRole, assignedBy: currentUserId ?? 'admin-1' } : r
      )
    );
    appendAudit({
      action: 'ADMIN_ROLE_UPDATED',
      affectedUserId: userId,
      recordType: 'user_roles',
      recordId: userId,
      details: `Assigned role "${exchangeService.getRoleLabel(nextRole)}".`,
    });
    return { ok: true, message: `Updated role to ${exchangeService.getRoleLabel(nextRole)}.` };
  };

  const runBalanceReconciliation = (): ActionResult => {
    if (!isAdmin) return { ok: false, message: 'Admin permission required.' };
    const totalWalletBalances = roundAmount(
      walletBalances.reduce((sum, b) => sum + b.available + b.reserved, 0),
      8
    );
    const totalLedgerEntries = roundAmount(
      ledgerEntries.reduce((sum, e) => sum + e.deltaAmount, 0),
      8
    );
    const diff = roundAmount(totalWalletBalances - totalLedgerEntries, 8);
    const run: ReconciliationRun = {
      id: exchangeService.generateId('rec'),
      scope: 'ledger_vs_balances',
      assetSymbol: 'ALL',
      expectedTotal: totalLedgerEntries,
      observedTotal: totalWalletBalances,
      discrepancy: diff,
      status: diff === 0 ? 'matched' : 'mismatch',
      details:
        diff === 0
          ? 'Wallet available+reserved totals match append-only ledger entry sums.'
          : `Detected discrepancy of ${diff} between wallet balances and ledger sums.`,
      createdAt: new Date().toISOString(),
    };
    setReconciliationRuns((prev) => [run, ...prev]);
    appendAudit({
      action: 'RECONCILIATION_EXECUTED',
      affectedUserId: null,
      recordType: 'reconciliation_runs',
      recordId: run.id,
      details: run.details,
    });
    return { ok: diff === 0, message: run.details };
  };

  const value: AppStateContextValue = {
    theme,
    toggleTheme,
    language,
    setLanguage,
    hideBalances,
    toggleHideBalances,
    currentUserId,
    currentProfile,
    currentRole,
    isAdmin,
    authLoading,
    login,
    register,
    logout,
    recoverPassword,
    updatePassword,
    profiles,
    customerProfiles,
    userRoles,
    assets,
    networks,
    tradingPairs,
    marketPrices,
    marketSettings,
    marketLoading,
    marketFeedIsCached,
    marketFeedError,
    refreshMarketTickers,
    watchlist,
    toggleWatchlist,
    isWatchlisted,
    providerHealth,
    reconciliationRuns,
    walletBalances,
    depositAddresses,
    deposits,
    withdrawals,
    kycSubmissions,
    spotOrders,
    trades,
    ledgerTransactions,
    ledgerEntries,
    notificationCampaigns,
    notifications,
    auditLogs,
    currentUserBalances,
    currentUserKyc,
    currentUserDepositAddresses,
    currentUserDeposits,
    currentUserWithdrawals,
    currentUserOrders,
    currentUserTrades,
    currentUserTransactions,
    currentUserNotifications,
    unreadNotificationsCount,
    updateCustomerProfile,
    toggleTwoFactor,
    submitKyc,
    requestDepositAddress,
    requestWithdrawal,
    cancelWithdrawal,
    submitSpotOrder,
    markNotificationRead,
    markAllNotificationsRead,
    toggleCustomerAccountStatus,
    reviewKyc,
    reviewDeposit,
    reviewWithdrawal,
    dispatchApprovedWithdrawal,
    finalizeWithdrawalRecord,
    refundFailedWithdrawal,
    updateNetworkConfig,
    createLedgerAdjustment,
    updateAsset,
    updateTradingPair,
    updateMarketSettings,
    sendNotificationCampaign,
    updateAdminRole,
    runBalanceReconciliation,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
};

export function useAppState(): AppStateContextValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
