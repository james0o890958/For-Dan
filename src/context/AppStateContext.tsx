import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  INITIAL_ASSETS,
  INITIAL_AUDIT_LOGS,
  INITIAL_DEPOSIT_ADDRESSES,
  INITIAL_DEPOSITS,
  INITIAL_KYC_SUBMISSIONS,
  INITIAL_LEDGER_ENTRIES,
  INITIAL_LEDGER_TRANSACTIONS,
  INITIAL_MANUAL_PURCHASE_ORDERS,
  INITIAL_MARKET_PRICES,
  INITIAL_MARKET_SETTINGS,
  INITIAL_NETWORKS,
  INITIAL_NOTIFICATIONS,
  INITIAL_NOTIFICATION_CAMPAIGNS,
  INITIAL_PROFILES,
  INITIAL_RECEIVING_ADDRESSES,
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
import { exchangeApi } from '../services/exchangeApi';
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
  ManualPurchaseOrder,
  ManualPurchaseVerificationChecklist,
  MarketDataStatus,
  MarketPrice,
  MarketSettings,
  NetworkConfig,
  NotificationCampaign,
  NotificationCategory,
  NotificationItem,
  Profile,
  ProviderHealth,
  ReceivingAddress,
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
  cancelManualPurchaseOrderRecord,
  createManualPurchaseOrderRecord,
  fulfilManualPurchaseOrderRecord,
  reviewManualPurchaseOrderRecord,
  submitManualPurchasePayment,
  toggleReceivingAddressStatusRecord,
  upsertReceivingAddressRecord,
} from '../utils/manualPurchaseEngine';
import { SANDBOX_REFERENCE_MARKETS } from '../utils/overviewModel';
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
  backendMode: boolean;
  backendSyncing: boolean;
  backendSyncError: string | null;
  refreshAccountData: () => Promise<void>;
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
  receivingAddresses: ReceivingAddress[];
  activeReceivingAddresses: ReceivingAddress[];
  manualPurchaseOrders: ManualPurchaseOrder[];

  // Derived for current user
  currentUserBalances: WalletBalance[];
  currentUserKyc: KycSubmission | null;
  currentUserDepositAddresses: DepositAddress[];
  currentUserDeposits: DepositRecord[];
  currentUserWithdrawals: WithdrawalRequest[];
  currentUserOrders: SpotOrder[];
  currentUserManualPurchaseOrders: ManualPurchaseOrder[];
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
  submitDeposit: (payload: { assetSymbol: string; networkCode: string; amount: number; txHash: string }) => Promise<ActionResult>;
  requestWithdrawal: (input: WithdrawalRequestInput) => ActionResult;
  cancelWithdrawal: (withdrawalId: string) => ActionResult;
  submitSpotOrder: (input: SpotTradeInput) => Promise<ActionResult>;
  createManualPurchaseOrder: (input: {
    pairSymbol: string;
    orderType: 'MARKET' | 'LIMIT';
    requestedQuoteAmount: number;
    limitPrice?: number | null;
    receivingAddressId: string;
  }) => Promise<ActionResult & { order?: ManualPurchaseOrder }>;
  submitManualPurchasePaymentDetails: (input: {
    orderId: string;
    paymentTxHash: string;
    actualAmountSent: number;
    paymentNote?: string;
  }) => Promise<ActionResult & { order?: ManualPurchaseOrder }>;
  cancelManualPurchaseOrder: (orderId: string, reason?: string) => Promise<ActionResult>;
  markNotificationRead: (notificationId: string) => void;
  markAllNotificationsRead: () => void;

  // Admin actions
  toggleCustomerAccountStatus: (customerUserId: string, nextStatus: AccountStatus, reason: string) => ActionResult;
  reviewKyc: (submissionId: string, decision: 'approved' | 'rejected', rejectionReason?: string) => ActionResult;
  confirmDepositFinality: (depositId: string, confirmations?: number) => Promise<ActionResult>;
  reviewDeposit: (depositId: string, decision: 'approved' | 'rejected', adminNote: string) => Promise<ActionResult>;
  assignDepositAddress: (payload: { userId: string; assetSymbol: string; networkCode: string; address: string; memoOrTag?: string }) => Promise<ActionResult>;
  saveReceivingAddress: (payload: {
    id?: string;
    assetSymbol: string;
    networkCode: string;
    address: string;
    memoOrTag?: string;
    label?: string;
    isActive?: boolean;
  }) => Promise<ActionResult & { receivingAddress?: ReceivingAddress }>;
  toggleReceivingAddressStatus: (addressId: string, isActive: boolean, note?: string) => Promise<ActionResult>;
  reviewManualPurchaseOrder: (input: {
    orderId: string;
    targetStatus: 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
    checklist?: Partial<ManualPurchaseVerificationChecklist>;
    adminRemark?: string;
    rejectionReason?: string;
    expectedVersion?: number;
  }) => Promise<ActionResult & { order?: ManualPurchaseOrder }>;
  fulfilManualPurchaseOrder: (input: {
    orderId: string;
    finalCryptoAmount?: number;
    finalFeeUsdt?: number;
    adminRemark?: string;
    expectedVersion?: number;
  }) => Promise<ActionResult & { order?: ManualPurchaseOrder }>;
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
  const [backendMode, setBackendMode] = useState<boolean>(false);
  const [backendSyncing, setBackendSyncing] = useState<boolean>(false);
  const [backendSyncError, setBackendSyncError] = useState<string | null>(null);
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
  const [depositAddresses, setDepositAddresses] = useState<DepositAddress[]>(INITIAL_DEPOSIT_ADDRESSES);
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
  const [receivingAddresses, setReceivingAddresses] = useState<ReceivingAddress[]>(
    INITIAL_RECEIVING_ADDRESSES
  );
  const [manualPurchaseOrders, setManualPurchaseOrders] = useState<ManualPurchaseOrder[]>(
    INITIAL_MANUAL_PURCHASE_ORDERS
  );

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

  const refreshAccountData = async () => {
    if (!currentUserId || !backendMode) return;
    setBackendSyncing(true);
    setBackendSyncError(null);
    const adminSession = currentRole !== 'customer';

    try {
      if (adminSession) {
        const [
          summaryRes,
          customersRes,
          ledgerRes,
          depositsRes,
          depAddrRes,
          recAddrRes,
          ordersRes,
        ] = await Promise.all([
          exchangeApi.fetchWalletSummary(),
          exchangeApi.fetchAdminCustomers(),
          exchangeApi.fetchAdminLedger(),
          exchangeApi.fetchAdminDeposits(),
          exchangeApi.fetchAdminDepositAddresses(),
          exchangeApi.fetchAdminReceivingAddresses(),
          exchangeApi.fetchAdminPurchaseOrders(),
        ]);

        if (summaryRes.ok && summaryRes.data) {
          if (summaryRes.data.assets.length > 0) setAssets(summaryRes.data.assets);
          if (summaryRes.data.networks.length > 0) setNetworks(summaryRes.data.networks);
          if (summaryRes.data.tradingPairs.length > 0) setTradingPairs(summaryRes.data.tradingPairs);
          setNotifications(summaryRes.data.notifications);
        }
        if (customersRes.ok && customersRes.data) {
          setProfiles(customersRes.data.profiles);
          setUserRoles(customersRes.data.userRoles);
        }
        if (ledgerRes.ok && ledgerRes.data) {
          setWalletBalances(ledgerRes.data.walletBalances);
          setLedgerTransactions(ledgerRes.data.ledgerTransactions);
          setLedgerEntries(ledgerRes.data.ledgerEntries);
          setAuditLogs(ledgerRes.data.auditLogs);
        }
        if (depositsRes.ok && depositsRes.data) {
          setDeposits(depositsRes.data);
        }
        if (depAddrRes.ok && depAddrRes.data) {
          setDepositAddresses(depAddrRes.data);
        }
        if (recAddrRes.ok && recAddrRes.data) {
          setReceivingAddresses(recAddrRes.data);
        }
        if (ordersRes.ok && ordersRes.data) {
          setManualPurchaseOrders(ordersRes.data);
        }

        const firstFailure = [
          summaryRes,
          customersRes,
          ledgerRes,
          depositsRes,
          depAddrRes,
          recAddrRes,
          ordersRes,
        ].find((r) => !r.ok);
        if (firstFailure) {
          setBackendSyncError(firstFailure.message);
        }
      } else {
        const [summaryRes, txRes, depositsRes, recAddrRes, ordersRes] = await Promise.all([
          exchangeApi.fetchWalletSummary(),
          exchangeApi.fetchTransactions(),
          exchangeApi.fetchCustomerDeposits(),
          exchangeApi.fetchCustomerReceivingAddresses(),
          exchangeApi.fetchCustomerPurchaseOrders(),
        ]);

        if (summaryRes.ok && summaryRes.data) {
          const d = summaryRes.data;
          setProfiles([d.profile]);
          setUserRoles([
            {
              id: `role-${d.profile.id}`,
              userId: d.profile.id,
              role: d.role,
              assignedBy: 'database',
              createdAt: d.profile.createdAt,
            },
          ]);
          setWalletBalances(d.balances);
          setDepositAddresses(d.depositAddresses);
          if (d.assets.length > 0) setAssets(d.assets);
          if (d.networks.length > 0) setNetworks(d.networks);
          if (d.tradingPairs.length > 0) setTradingPairs(d.tradingPairs);
          setNotifications(d.notifications);
        }
        if (txRes.ok && txRes.data) {
          setLedgerTransactions(txRes.data.transactions);
          setLedgerEntries(txRes.data.entries);
        }
        if (depositsRes.ok && depositsRes.data) {
          setDeposits(depositsRes.data);
        }
        if (recAddrRes.ok && recAddrRes.data) {
          setReceivingAddresses(recAddrRes.data);
        }
        if (ordersRes.ok && ordersRes.data) {
          setManualPurchaseOrders(ordersRes.data);
        }

        const firstFailure = [summaryRes, txRes, depositsRes, recAddrRes, ordersRes].find(
          (r) => !r.ok
        );
        if (firstFailure) {
          setBackendSyncError(firstFailure.message);
        }
      }
    } finally {
      setBackendSyncing(false);
    }
  };

  const hydrateAuthenticatedSnapshot = (snapshot: {
    profile: Profile;
    role: AppRole;
    balances?: WalletBalance[];
  }) => {
    setBackendMode(true);
    setBackendSyncError(null);
    setProfiles([snapshot.profile]);
    setUserRoles([
      {
        id: `role-${snapshot.profile.id}`,
        userId: snapshot.profile.id,
        role: snapshot.role,
        assignedBy: 'database',
        createdAt: snapshot.profile.createdAt,
      },
    ]);
    setWalletBalances(Array.isArray(snapshot.balances) ? snapshot.balances : []);
    setDepositAddresses([]);
    setDeposits([]);
    setWithdrawals([]);
    setKycSubmissions([]);
    setSpotOrders([]);
    setLedgerTransactions([]);
    setLedgerEntries([]);
    setNotifications([]);
    setAuditLogs([]);
    setReceivingAddresses([]);
    setManualPurchaseOrders([]);

    setCurrentUserId(snapshot.profile.id);
    setLanguageState(snapshot.profile.preferredLanguage);
  };

  useEffect(() => {
    if (!backendMode || !currentUserId) return;
    void refreshAccountData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendMode, currentUserId, currentRole]);

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
    setBackendMode(false);
    setBackendSyncError(null);
    setProfiles(INITIAL_PROFILES);
    setUserRoles(INITIAL_USER_ROLES);
    setAssets(INITIAL_ASSETS);
    setNetworks(INITIAL_NETWORKS);
    setTradingPairs(INITIAL_TRADING_PAIRS);
    setWalletBalances(INITIAL_WALLET_BALANCES);
    setDepositAddresses(INITIAL_DEPOSIT_ADDRESSES);
    setDeposits(INITIAL_DEPOSITS);
    setWithdrawals(INITIAL_WITHDRAWALS);
    setKycSubmissions(INITIAL_KYC_SUBMISSIONS);
    setSpotOrders(INITIAL_SPOT_ORDERS);
    setLedgerTransactions(INITIAL_LEDGER_TRANSACTIONS);
    setLedgerEntries(INITIAL_LEDGER_ENTRIES);
    setNotifications(INITIAL_NOTIFICATIONS);
    setAuditLogs(INITIAL_AUDIT_LOGS);
    setReceivingAddresses(INITIAL_RECEIVING_ADDRESSES);
    setManualPurchaseOrders(INITIAL_MANUAL_PURCHASE_ORDERS);
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

  const activeReceivingAddresses = useMemo(
    () => receivingAddresses.filter((r) => r.isActive),
    [receivingAddresses]
  );

  const currentUserManualPurchaseOrders = useMemo(
    () =>
      manualPurchaseOrders
        .filter((o) => o.userId === currentUserId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [manualPurchaseOrders, currentUserId]
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

    if (backendMode) {
      await refreshAccountData();
      return {
        ok: false,
        message: `No ${payload.assetSymbol} (${payload.networkCode}) custody deposit address is assigned to your account yet. An administrator must assign one before submitting a deposit.`,
      };
    }

    const res = await unconfiguredCustodyProvider.getOrCreateDepositAddress({
      userId: currentProfile.id,
      assetSymbol: payload.assetSymbol,
      networkCode: payload.networkCode,
    });
    return { ok: res.ok, message: res.message };
  };

  const submitDeposit = async (payload: {
    assetSymbol: string;
    networkCode: string;
    amount: number;
    txHash: string;
  }): Promise<ActionResult> => {
    if (!currentProfile) return { ok: false, message: 'Please sign in first.' };

    if (backendMode) {
      const apiRes = await exchangeApi.submitDeposit(payload);
      if (!apiRes.ok || !apiRes.data) {
        return { ok: false, message: apiRes.message };
      }
      setDeposits((prev) => [apiRes.data!, ...prev.filter((d) => d.id !== apiRes.data!.id)]);
      await refreshAccountData();
      return {
        ok: true,
        message: 'Deposit submitted successfully and queued for admin verification.',
      };
    }

    if (currentProfile.accountStatus !== 'active') {
      return { ok: false, message: `Account is ${currentProfile.accountStatus}. Deposits are disabled.` };
    }
    if (currentProfile.kycStatus !== 'approved') {
      return { ok: false, message: 'Approved KYC verification is required before submitting deposits.' };
    }
    const net = networks.find(
      (n) =>
        n.assetSymbol.toUpperCase() === payload.assetSymbol.toUpperCase() &&
        n.code.toUpperCase() === payload.networkCode.toUpperCase()
    );
    if (net && !net.isDepositEnabled) {
      return { ok: false, message: `Deposits on ${payload.networkCode} are currently disabled.` };
    }
    const assigned = depositAddresses.find(
      (d) =>
        d.userId === currentProfile.id &&
        d.assetSymbol === payload.assetSymbol &&
        d.networkCode === payload.networkCode
    );
    if (!assigned) {
      return { ok: false, message: 'No deposit address assigned for this asset and network. Please request an address first.' };
    }
    const amt = Number(payload.amount);
    if (isNaN(amt) || amt <= 0) {
      return { ok: false, message: 'Please enter a valid deposit amount greater than zero.' };
    }
    const tx = payload.txHash.trim();
    if (!tx || tx.length < 10 || /\s/.test(tx)) {
      return { ok: false, message: 'A valid transaction hash / reference (min 10 chars, no spaces) is required.' };
    }
    const normalizedTx = tx.toLowerCase();
    const normalizedNet = payload.networkCode.trim().toUpperCase();
    const duplicateDeposit = deposits.some(
      (d) =>
        d.networkCode.trim().toUpperCase() === normalizedNet &&
        d.txHash.trim().toLowerCase() === normalizedTx
    );
    const duplicatePurchaseOrder = manualPurchaseOrders.some(
      (o) =>
        o.receivingNetwork.trim().toUpperCase() === normalizedNet &&
        (o.paymentTxHash?.trim().toLowerCase() ?? '') === normalizedTx &&
        o.status !== 'REJECTED' &&
        o.status !== 'CANCELLED'
    );
    if (duplicateDeposit || duplicatePurchaseOrder) {
      return { ok: false, message: 'Duplicate transaction hash detected on this network. This transaction has already been recorded.' };
    }

    const minDep = net?.minDeposit ?? 10;
    if (amt < minDep) {
      return { ok: false, message: `Amount is below the minimum deposit requirement of ${minDep} ${payload.assetSymbol}.` };
    }

    const now = new Date().toISOString();
    const newDep: DepositRecord = {
      id: `dep-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      userId: currentProfile.id,
      assetSymbol: payload.assetSymbol.toUpperCase(),
      networkCode: payload.networkCode,
      depositAddress: assigned.address,
      memoOrTag: assigned.memoOrTag,
      txHash: tx,
      fromAddress: null,
      amount: amt,
      confirmations: 1,
      requiredConfirmations: net?.requiredConfirmations ?? 12,
      addressVerified: true,
      networkVerified: true,
      amountVerified: true,
      duplicateChecked: true,
      kytStatus: 'passed',
      kytRiskScore: 10,
      status: 'PENDING_ADMIN_REVIEW',
      adminNote: null,
      reviewedBy: null,
      reviewedAt: null,
      creditedTxId: null,
      createdAt: now,
      updatedAt: now,
    };

    setDeposits((prev) => [newDep, ...prev]);
    return { ok: true, message: 'Deposit submitted successfully and queued for admin verification.' };
  };

  const assignDepositAddress = async (payload: {
    userId: string;
    assetSymbol: string;
    networkCode: string;
    address: string;
    memoOrTag?: string;
  }): Promise<ActionResult> => {
    if (!currentProfile || !isAdmin) {
      return { ok: false, message: 'Unauthorized. Admin role required to assign deposit addresses.' };
    }

    if (backendMode) {
      const apiRes = await exchangeApi.assignDepositAddress(payload);
      if (!apiRes.ok || !apiRes.data) {
        return { ok: false, message: apiRes.message };
      }
      const saved = apiRes.data;
      setDepositAddresses((prev) => [
        saved,
        ...prev.filter(
          (d) =>
            !(
              d.userId === saved.userId &&
              d.assetSymbol === saved.assetSymbol &&
              d.networkCode === saved.networkCode
            )
        ),
      ]);
      await refreshAccountData();
      return {
        ok: true,
        message: `Successfully assigned ${saved.assetSymbol} (${saved.networkCode}) address to customer.`,
      };
    }

    const targetCustomer = profiles.find((p) => p.id === payload.userId);
    if (!targetCustomer) {
      return { ok: false, message: 'Customer profile not found.' };
    }
    if (targetCustomer.accountStatus !== 'active') {
      return { ok: false, message: `Cannot assign deposit address to ${targetCustomer.accountStatus} customer account.` };
    }
    const trimmed = payload.address.trim();
    if (!trimmed) {
      return { ok: false, message: 'Deposit address cannot be empty.' };
    }
    const normalizedAsset = payload.assetSymbol.toUpperCase();
    const net = networks.find(
      (n) =>
        n.assetSymbol.toUpperCase() === normalizedAsset &&
        n.code.toUpperCase() === payload.networkCode.trim().toUpperCase()
    );
    if (net) {
      try {
        const regex = new RegExp(net.addressPattern);
        if (!regex.test(trimmed)) {
          return { ok: false, message: `Address format does not match ${net.code} network validation rules.` };
        }
      } catch {
        // Ignore malformed pattern
      }
      if (net.memoRequired && !payload.memoOrTag?.trim()) {
        return { ok: false, message: `Destination tag/memo is required for ${net.code}.` };
      }
    }
    const newAddr: DepositAddress = {
      id: `addr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      userId: payload.userId,
      assetSymbol: normalizedAsset,
      networkCode: net?.code ?? payload.networkCode,
      custodyVaultId: 'vault-manual-admin',
      address: trimmed,
      memoOrTag: payload.memoOrTag?.trim() || null,
      createdAt: new Date().toISOString(),
    };
    setDepositAddresses((prev) => [
      newAddr,
      ...prev.filter(
        (d) => !(d.userId === payload.userId && d.assetSymbol === newAddr.assetSymbol && d.networkCode === newAddr.networkCode)
      ),
    ]);
    return { ok: true, message: `Successfully assigned ${newAddr.assetSymbol} (${newAddr.networkCode}) address to customer.` };
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

  const pushSystemNotification = (
    userId: string,
    title: string,
    message: string,
    category: NotificationCategory = 'Trade'
  ) => {
    const now = new Date().toISOString();
    const item: NotificationItem = {
      id: exchangeService.generateId('notif'),
      campaignId: 'system-manual-purchase',
      userId,
      title,
      message,
      category,
      isRead: false,
      readAt: null,
      createdAt: now,
    };
    setNotifications((prev) => [item, ...prev]);
  };

  const createManualPurchaseOrder = async (input: {
    pairSymbol: string;
    orderType: 'MARKET' | 'LIMIT';
    requestedQuoteAmount: number;
    limitPrice?: number | null;
    receivingAddressId: string;
  }): Promise<ActionResult & { order?: ManualPurchaseOrder }> => {
    if (!currentProfile) {
      return { ok: false, message: 'Please sign in with an approved KYC account first.' };
    }

    if (backendMode) {
      const apiRes = await exchangeApi.createPurchaseOrder(input);
      if (!apiRes.ok || !apiRes.data) {
        return { ok: false, message: apiRes.message };
      }
      const created = apiRes.data;
      setManualPurchaseOrders((prev) => [created, ...prev.filter((o) => o.id !== created.id)]);
      await refreshAccountData();
      return {
        ok: true,
        message: `Purchase order ${created.orderRef} created. Follow the payment instructions to submit your transaction reference.`,
        order: created,
      };
    }

    const pair = tradingPairs.find((p) => p.symbol === input.pairSymbol);
    const baseAsset = pair ? assets.find((a) => a.symbol === pair.baseAsset) : undefined;
    const quoteAsset = pair ? assets.find((a) => a.symbol === pair.quoteAsset) : undefined;
    const market = pair ? marketPrices.find((m) => m.symbol === pair.symbol) : undefined;
    const refFallback = pair ? SANDBOX_REFERENCE_MARKETS[pair.symbol]?.price ?? 0 : 0;
    const referenceMarketPrice =
      market && market.price > 0 ? market.price : refFallback;

    const selectedAddr = receivingAddresses.find((r) => r.id === input.receivingAddressId);
    const networkConfig = selectedAddr
      ? networks.find(
          (n) =>
            n.assetSymbol === selectedAddr.assetSymbol &&
            n.code === selectedAddr.networkCode
        )
      : undefined;

    const now = new Date().toISOString();
    const id = exchangeService.generateId('mpo');
    const orderRef = `MPO-${now.slice(0, 10).replace(/-/g, '')}-${id.slice(-6).toUpperCase()}`;

    const res = createManualPurchaseOrderRecord({
      id,
      orderRef,
      eventId: exchangeService.generateId('mpe'),
      userId: currentProfile.id,
      actorLabel: currentProfile.fullName,
      side: 'buy',
      orderType: input.orderType,
      pair,
      baseAsset,
      quoteAsset,
      requestedQuoteAmount: input.requestedQuoteAmount,
      limitPrice: input.limitPrice,
      referenceMarketPrice,
      accountStatus: currentProfile.accountStatus,
      kycStatus: currentProfile.kycStatus,
      receivingAddress: selectedAddr,
      networkConfig,
      nowIso: now,
    });

    if (!res.ok || !res.data) {
      return { ok: false, message: res.error ?? 'Unable to create purchase order.' };
    }

    setManualPurchaseOrders((prev) => [res.data!, ...prev]);
    pushSystemNotification(
      currentProfile.id,
      `Purchase Request Created (${res.data.orderRef})`,
      `Send ${res.data.totalPaymentAmount} ${res.data.paymentAsset} on ${res.data.receivingNetwork} to complete your ${res.data.pairSymbol} manual buy order.`,
      'Trade'
    );

    return {
      ok: true,
      message: `Purchase order ${res.data.orderRef} created. Follow the payment instructions to submit your transaction reference.`,
      order: res.data,
    };
  };

  const submitManualPurchasePaymentDetails = async (input: {
    orderId: string;
    paymentTxHash: string;
    actualAmountSent: number;
    paymentNote?: string;
  }): Promise<ActionResult & { order?: ManualPurchaseOrder }> => {
    if (!currentProfile) {
      return { ok: false, message: 'Authentication required.' };
    }

    if (backendMode) {
      const apiRes = await exchangeApi.submitPurchasePayment(input.orderId, {
        paymentTxHash: input.paymentTxHash,
        actualAmountSent: input.actualAmountSent,
        paymentNote: input.paymentNote,
      });
      if (!apiRes.ok || !apiRes.data) {
        return { ok: false, message: apiRes.message };
      }
      const updated = apiRes.data;
      setManualPurchaseOrders((prev) =>
        prev.map((o) => (o.id === updated.id ? updated : o))
      );
      await refreshAccountData();
      return {
        ok: true,
        message: `Payment details submitted for ${updated.orderRef}. Order status is now ${updated.status}.`,
        order: updated,
      };
    }

    const target = manualPurchaseOrders.find((o) => o.id === input.orderId);
    if (!target || target.userId !== currentProfile.id) {
      return { ok: false, message: 'Purchase order not found.' };
    }

    const res = submitManualPurchasePayment({
      order: target,
      actorUserId: currentProfile.id,
      actorLabel: currentProfile.fullName,
      actorAccountStatus: currentProfile.accountStatus,
      paymentTxHash: input.paymentTxHash,
      actualAmountSent: input.actualAmountSent,
      paymentNote: input.paymentNote,
      existingOrders: manualPurchaseOrders,
      existingDeposits: deposits,
      eventId: exchangeService.generateId('mpe'),
      nowIso: new Date().toISOString(),
    });

    if (!res.ok || !res.data) {
      return { ok: false, message: res.error ?? 'Unable to submit payment details.' };
    }

    setManualPurchaseOrders((prev) =>
      prev.map((o) => (o.id === target.id ? res.data! : o))
    );
    pushSystemNotification(
      currentProfile.id,
      `Payment Submitted (${res.data.orderRef})`,
      `Transaction reference recorded for ${res.data.pairSymbol}. An administrator will independently verify your payment.`,
      'Trade'
    );

    return {
      ok: true,
      message: `Payment details submitted for ${res.data.orderRef}. Order status is now PAYMENT_SUBMITTED.`,
      order: res.data,
    };
  };

  const cancelManualPurchaseOrder = async (
    orderId: string,
    reason?: string
  ): Promise<ActionResult> => {
    if (!currentProfile) return { ok: false, message: 'Authentication required.' };

    if (backendMode) {
      const apiRes = await exchangeApi.cancelPurchaseOrder(orderId, reason);
      if (!apiRes.ok || !apiRes.data) {
        return { ok: false, message: apiRes.message };
      }
      const cancelled = apiRes.data;
      setManualPurchaseOrders((prev) =>
        prev.map((o) => (o.id === cancelled.id ? cancelled : o))
      );
      await refreshAccountData();
      return { ok: true, message: `Order ${cancelled.orderRef} cancelled.` };
    }

    const target = manualPurchaseOrders.find((o) => o.id === orderId);
    if (!target || target.userId !== currentProfile.id) {
      return { ok: false, message: 'Purchase order not found.' };
    }

    const res = cancelManualPurchaseOrderRecord({
      order: target,
      actorUserId: currentProfile.id,
      actorLabel: currentProfile.fullName,
      reason,
      eventId: exchangeService.generateId('mpe'),
      nowIso: new Date().toISOString(),
    });

    if (!res.ok || !res.data) {
      return { ok: false, message: res.error ?? 'Unable to cancel purchase order.' };
    }

    setManualPurchaseOrders((prev) =>
      prev.map((o) => (o.id === target.id ? res.data! : o))
    );
    pushSystemNotification(
      currentProfile.id,
      `Order Cancelled (${res.data.orderRef})`,
      `Your manual crypto purchase order ${res.data.orderRef} has been cancelled.`,
      'Trade'
    );

    return { ok: true, message: `Order ${res.data.orderRef} cancelled.` };
  };

  const saveReceivingAddress = async (payload: {
    id?: string;
    assetSymbol: string;
    networkCode: string;
    address: string;
    memoOrTag?: string;
    label?: string;
    isActive?: boolean;
  }): Promise<ActionResult & { receivingAddress?: ReceivingAddress }> => {
    if (!currentProfile || !isAdmin) {
      return { ok: false, message: 'Administrator permission required.' };
    }

    if (backendMode) {
      const apiRes = await exchangeApi.saveReceivingAddress(payload);
      if (!apiRes.ok || !apiRes.data) {
        return { ok: false, message: apiRes.message };
      }
      const saved = apiRes.data;
      setReceivingAddresses((prev) => {
        const exists = prev.some((a) => a.id === saved.id);
        return exists ? prev.map((a) => (a.id === saved.id ? saved : a)) : [saved, ...prev];
      });
      await refreshAccountData();
      return {
        ok: true,
        message: `Receiving address saved for ${saved.assetSymbol} (${saved.networkCode}).`,
        receivingAddress: saved,
      };
    }

    const net = networks.find(
      (n) =>
        n.assetSymbol === payload.assetSymbol.trim().toUpperCase() &&
        n.code === payload.networkCode.trim().toUpperCase()
    );
    const id = payload.id?.trim() || exchangeService.generateId('recv');
    const res = upsertReceivingAddressRecord({
      id,
      assetSymbol: payload.assetSymbol,
      networkCode: payload.networkCode,
      address: payload.address,
      memoOrTag: payload.memoOrTag,
      label: payload.label,
      isActive: payload.isActive,
      adminUserId: currentProfile.id,
      adminLabel: currentProfile.fullName,
      adminRole: currentRole,
      existingAddresses: receivingAddresses,
      networkConfig: net,
      nowIso: new Date().toISOString(),
    });

    if (!res.ok || !res.data) {
      return { ok: false, message: res.error ?? 'Unable to save receiving address.' };
    }

    const exists = receivingAddresses.some((a) => a.id === res.data!.id);
    setReceivingAddresses((prev) =>
      exists
        ? prev.map((a) => (a.id === res.data!.id ? res.data! : a))
        : [res.data!, ...prev]
    );
    appendAudit({
      action: exists ? 'RECEIVING_ADDRESS_UPDATED' : 'RECEIVING_ADDRESS_CREATED',
      affectedUserId: null,
      recordType: 'receiving_addresses',
      recordId: res.data.id,
      details: `${exists ? 'Updated' : 'Registered'} receiving address for ${res.data.assetSymbol} (${res.data.networkCode}): ${res.data.address}`,
    });

    return {
      ok: true,
      message: `Receiving address saved for ${res.data.assetSymbol} (${res.data.networkCode}).`,
      receivingAddress: res.data,
    };
  };

  const toggleReceivingAddressStatus = async (
    addressId: string,
    isActive: boolean,
    note?: string
  ): Promise<ActionResult> => {
    if (!currentProfile || !isAdmin) {
      return { ok: false, message: 'Administrator permission required.' };
    }

    if (backendMode) {
      const apiRes = await exchangeApi.toggleReceivingAddressStatus(addressId, isActive, note);
      if (!apiRes.ok || !apiRes.data) {
        return { ok: false, message: apiRes.message };
      }
      const updated = apiRes.data;
      setReceivingAddresses((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      await refreshAccountData();
      return {
        ok: true,
        message: `Receiving address marked ${updated.isActive ? 'active' : 'disabled'}. Existing submitted orders retain their snapshot.`,
      };
    }

    const target = receivingAddresses.find((a) => a.id === addressId);
    if (!target) return { ok: false, message: 'Receiving address not found.' };

    const res = toggleReceivingAddressStatusRecord({
      addressRecord: target,
      nextIsActive: isActive,
      adminUserId: currentProfile.id,
      adminLabel: currentProfile.fullName,
      adminRole: currentRole,
      note,
      nowIso: new Date().toISOString(),
    });

    if (!res.ok || !res.data) {
      return { ok: false, message: res.error ?? 'Unable to update address status.' };
    }

    setReceivingAddresses((prev) =>
      prev.map((a) => (a.id === addressId ? res.data! : a))
    );
    appendAudit({
      action: isActive ? 'RECEIVING_ADDRESS_ACTIVATED' : 'RECEIVING_ADDRESS_DISABLED',
      affectedUserId: null,
      recordType: 'receiving_addresses',
      recordId: addressId,
      details: `${isActive ? 'Activated' : 'Disabled'} ${target.assetSymbol} (${target.networkCode}) receiving address ${target.address}.`,
    });

    return {
      ok: true,
      message: `Receiving address marked ${isActive ? 'active' : 'disabled'}. Existing submitted orders retain their snapshot.`,
    };
  };

  const reviewManualPurchaseOrder = async (input: {
    orderId: string;
    targetStatus: 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
    checklist?: Partial<ManualPurchaseVerificationChecklist>;
    adminRemark?: string;
    rejectionReason?: string;
    expectedVersion?: number;
  }): Promise<ActionResult & { order?: ManualPurchaseOrder }> => {
    if (!currentProfile || !isAdmin) {
      return { ok: false, message: 'Administrator permission required.' };
    }

    if (backendMode) {
      const apiRes = await exchangeApi.reviewManualPurchaseOrder(input.orderId, {
        targetStatus: input.targetStatus,
        checklist: input.checklist,
        adminRemark: input.adminRemark,
        rejectionReason: input.rejectionReason,
        expectedVersion: input.expectedVersion,
      });
      if (!apiRes.ok || !apiRes.data) {
        await refreshAccountData();
        return { ok: false, message: apiRes.message };
      }
      const updated = apiRes.data;
      setManualPurchaseOrders((prev) =>
        prev.map((o) => (o.id === updated.id ? updated : o))
      );
      await refreshAccountData();
      return {
        ok: true,
        message: `Order ${updated.orderRef} updated to ${updated.status}.`,
        order: updated,
      };
    }

    const target = manualPurchaseOrders.find((o) => o.id === input.orderId);
    if (!target) return { ok: false, message: 'Manual purchase order not found.' };

    const res = reviewManualPurchaseOrderRecord({
      order: target,
      adminUserId: currentProfile.id,
      adminLabel: currentProfile.fullName,
      adminRole: currentRole,
      targetStatus: input.targetStatus,
      checklist: input.checklist,
      adminRemark: input.adminRemark,
      rejectionReason: input.rejectionReason,
      expectedVersion: input.expectedVersion,
      existingOrders: manualPurchaseOrders,
      existingDeposits: deposits,
      eventId: exchangeService.generateId('mpe'),
      nowIso: new Date().toISOString(),
    });

    if (!res.ok || !res.data) {
      return { ok: false, message: res.error ?? 'Order review failed.' };
    }

    setManualPurchaseOrders((prev) =>
      prev.map((o) => (o.id === target.id ? res.data! : o))
    );

    const actionMap = {
      UNDER_REVIEW: 'MANUAL_PURCHASE_UNDER_REVIEW',
      APPROVED: 'MANUAL_PURCHASE_APPROVED',
      REJECTED: 'MANUAL_PURCHASE_REJECTED',
    } as const;
    const titleMap = {
      UNDER_REVIEW: `Order Under Review (${res.data.orderRef})`,
      APPROVED: `Order Approved for Fulfilment (${res.data.orderRef})`,
      REJECTED: `Purchase Order Rejected (${res.data.orderRef})`,
    };
    const msgMap = {
      UNDER_REVIEW: `Your ${res.data.pairSymbol} payment proof is currently under verification review.`,
      APPROVED: `Your payment for ${res.data.orderRef} passed verification and is awaiting final wallet credit.`,
      REJECTED: `Your purchase order ${res.data.orderRef} was rejected. Reason: ${res.data.rejectionReason}`,
    };

    appendAudit({
      action: actionMap[input.targetStatus],
      affectedUserId: target.userId,
      recordType: 'manual_purchase_orders',
      recordId: target.id,
      details: `${input.targetStatus} order ${res.data.orderRef} (${res.data.pairSymbol}). ${res.data.rejectionReason || res.data.adminRemark || ''}`,
    });
    pushSystemNotification(
      target.userId,
      titleMap[input.targetStatus],
      msgMap[input.targetStatus],
      'Trade'
    );

    return {
      ok: true,
      message: `Order ${res.data.orderRef} updated to ${res.data.status}.`,
      order: res.data,
    };
  };

  const fulfilManualPurchaseOrder = async (input: {
    orderId: string;
    finalCryptoAmount?: number;
    finalFeeUsdt?: number;
    adminRemark?: string;
    expectedVersion?: number;
  }): Promise<ActionResult & { order?: ManualPurchaseOrder }> => {
    if (!currentProfile || !isAdmin) {
      return { ok: false, message: 'Administrator permission required.' };
    }

    if (backendMode) {
      const apiRes = await exchangeApi.fulfilManualPurchaseOrder(input.orderId, {
        finalCryptoAmount: input.finalCryptoAmount,
        finalFeeUsdt: input.finalFeeUsdt,
        adminRemark: input.adminRemark,
        expectedVersion: input.expectedVersion,
      });
      if (!apiRes.ok || !apiRes.data) {
        await refreshAccountData();
        return { ok: false, message: apiRes.message };
      }
      const updated = apiRes.data;
      setManualPurchaseOrders((prev) =>
        prev.map((o) => (o.id === updated.id ? updated : o))
      );
      await refreshAccountData();
      return {
        ok: true,
        message: `Order ${updated.orderRef} fulfilled. Credited ${updated.finalCryptoAmount} ${updated.baseAsset} via ledger transaction ${updated.creditedTxId ?? 'posted'}.`,
        order: updated,
      };
    }

    const target = manualPurchaseOrders.find((o) => o.id === input.orderId);
    if (!target) return { ok: false, message: 'Manual purchase order not found.' };

    const customer = profiles.find((p) => p.id === target.userId);
    const res = fulfilManualPurchaseOrderRecord({
      order: target,
      adminUserId: currentProfile.id,
      adminLabel: currentProfile.fullName,
      adminRole: currentRole,
      customerAccountStatus: customer?.accountStatus ?? 'closed',
      finalCryptoAmount: input.finalCryptoAmount,
      finalFeeUsdt: input.finalFeeUsdt,
      adminRemark: input.adminRemark,
      expectedVersion: input.expectedVersion,
      existingOrders: manualPurchaseOrders,
      existingDeposits: deposits,
      balances: walletBalances,
      ledgerTransactions,
      txId: exchangeService.generateId('ltx'),
      entryId: exchangeService.generateId('le'),
      balanceId: exchangeService.generateId('wb'),
      eventId: exchangeService.generateId('mpe'),
      nowIso: new Date().toISOString(),
    });

    if (!res.ok || !res.data) {
      return { ok: false, message: res.error ?? 'Order fulfilment failed.' };
    }

    const { updatedOrder, updatedBalances, newTransaction, newEntry } = res.data;
    setManualPurchaseOrders((prev) =>
      prev.map((o) => (o.id === target.id ? updatedOrder : o))
    );
    setWalletBalances(updatedBalances);
    setLedgerTransactions((prev) => [newTransaction, ...prev]);
    setLedgerEntries((prev) => [newEntry, ...prev]);

    appendAudit({
      action: 'MANUAL_PURCHASE_FULFILLED',
      affectedUserId: target.userId,
      recordType: 'manual_purchase_orders',
      recordId: target.id,
      details: `Fulfilled ${updatedOrder.orderRef}: credited ${updatedOrder.finalCryptoAmount} ${updatedOrder.baseAsset} via ledger tx ${newTransaction.id}.`,
    });
    pushSystemNotification(
      target.userId,
      `Order Completed & Credited (${updatedOrder.orderRef})`,
      `${updatedOrder.finalCryptoAmount} ${updatedOrder.baseAsset} has been credited to your internal wallet ledger.`,
      'Trade'
    );

    return {
      ok: true,
      message: `Order ${updatedOrder.orderRef} fulfilled. Credited ${updatedOrder.finalCryptoAmount} ${updatedOrder.baseAsset} via ledger transaction ${newTransaction.id}.`,
      order: updatedOrder,
    };
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

  const confirmDepositFinality = async (
    depositId: string,
    confirmations?: number
  ): Promise<ActionResult> => {
    if (!isAdmin || !currentUserId) return { ok: false, message: 'Admin permission required.' };

    if (backendMode) {
      const apiRes = await exchangeApi.confirmDepositFinality(depositId, confirmations);
      if (!apiRes.ok || !apiRes.data) {
        await refreshAccountData();
        return { ok: false, message: apiRes.message };
      }
      const updated = apiRes.data;
      setDeposits((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      await refreshAccountData();
      return {
        ok: true,
        message: `Confirmations updated to ${updated.confirmations}/${updated.requiredConfirmations}.`,
      };
    }

    const target = deposits.find((d) => d.id === depositId);
    if (!target) return { ok: false, message: 'Deposit record not found.' };
    if (target.status === 'CREDITED' || target.status === 'REJECTED') {
      return { ok: false, message: 'Cannot modify block confirmations for a terminal deposit.' };
    }
    const nextConfirmations = Math.max(
      target.confirmations,
      confirmations ?? target.requiredConfirmations
    );
    const now = new Date().toISOString();
    setDeposits((prev) =>
      prev.map((d) =>
        d.id === depositId
          ? {
              ...d,
              confirmations: nextConfirmations,
              updatedAt: now,
            }
          : d
      )
    );
    appendAudit({
      action: 'DEPOSIT_FINALITY_VERIFIED',
      affectedUserId: target.userId,
      recordType: 'deposits',
      recordId: depositId,
      details: `Verified on-chain block finality for deposit ${target.amount} ${target.assetSymbol} (${target.networkCode}): ${nextConfirmations}/${target.requiredConfirmations} confirmations.`,
    });
    return {
      ok: true,
      message: `Confirmations updated to ${nextConfirmations}/${target.requiredConfirmations}.`,
    };
  };

  const reviewDeposit = async (
    depositId: string,
    decision: 'approved' | 'rejected',
    adminNote: string
  ): Promise<ActionResult> => {
    if (!isAdmin || !currentUserId) return { ok: false, message: 'Admin permission required.' };

    if (backendMode) {
      const apiRes = await exchangeApi.reviewDeposit(depositId, decision, adminNote);
      if (!apiRes.ok || !apiRes.data) {
        await refreshAccountData();
        return { ok: false, message: apiRes.message };
      }
      const updated = apiRes.data;
      setDeposits((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      await refreshAccountData();
      return {
        ok: true,
        message:
          decision === 'approved'
            ? 'Verified deposit approved and credited once to ledger.'
            : 'Deposit rejected.',
      };
    }

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

    const customer = profiles.find((p) => p.id === target.userId);
    const applied = applyDepositApproval({
      deposit: target,
      existingDeposits: deposits,
      balances: walletBalances,
      ledgerTransactions,
      customerAccountStatus: customer?.accountStatus ?? 'closed',
      existingManualPurchaseOrders: manualPurchaseOrders,
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
    backendMode,
    backendSyncing,
    backendSyncError,
    refreshAccountData,
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
    receivingAddresses,
    activeReceivingAddresses,
    manualPurchaseOrders,
    currentUserBalances,
    currentUserKyc,
    currentUserDepositAddresses,
    currentUserDeposits,
    currentUserWithdrawals,
    currentUserOrders,
    currentUserManualPurchaseOrders,
    currentUserTrades,
    currentUserTransactions,
    currentUserNotifications,
    unreadNotificationsCount,
    updateCustomerProfile,
    toggleTwoFactor,
    submitKyc,
    requestDepositAddress,
    submitDeposit,
    requestWithdrawal,
    cancelWithdrawal,
    submitSpotOrder,
    createManualPurchaseOrder,
    submitManualPurchasePaymentDetails,
    cancelManualPurchaseOrder,
    markNotificationRead,
    markAllNotificationsRead,
    toggleCustomerAccountStatus,
    reviewKyc,
    confirmDepositFinality,
    reviewDeposit,
    assignDepositAddress,
    saveReceivingAddress,
    toggleReceivingAddressStatus,
    reviewManualPurchaseOrder,
    fulfilManualPurchaseOrder,
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
