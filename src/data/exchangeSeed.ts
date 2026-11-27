import type {
  AdminAuditLog,
  Asset,
  DepositAddress,
  DepositRecord,
  KycSubmission,
  LedgerEntry,
  LedgerTransaction,
  ManualPurchaseOrder,
  MarketPrice,
  MarketSettings,
  NetworkConfig,
  NotificationCampaign,
  NotificationItem,
  Profile,
  ReceivingAddress,
  ReconciliationRun,
  SpotOrder,
  Trade,
  TradingPair,
  UserRoleRecord,
  WalletBalance,
  WithdrawalRequest,
} from '../types/domain';

export const SUPPORTED_LANGUAGES = [
  'English',
  'Malay',
  'Indonesia',
  'Japanese',
  'Tiếng Việt',
  'Português',
  'German',
  'Türkiye',
  'Nederlands',
  'Sweden',
  'France',
  'Spain',
  'Italy',
  'Poland',
  '繁體中文',
];

export const INITIAL_ASSETS: Asset[] = [
  {
    id: 'asset-usdt',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 2,
    isEnabled: true,
    sortOrder: 1,
    badgeColor: '#10C478',
    description: 'Primary settlement quote currency across supported spot markets.',
  },
  {
    id: 'asset-btc',
    symbol: 'BTC',
    name: 'Bitcoin',
    decimals: 8,
    isEnabled: true,
    sortOrder: 2,
    badgeColor: '#F7931A',
    description: 'Decentralized digital asset settled on the Bitcoin network.',
  },
  {
    id: 'asset-eth',
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 8,
    isEnabled: true,
    sortOrder: 3,
    badgeColor: '#627EEA',
    description: 'Native settlement asset for the Ethereum network.',
  },
  {
    id: 'asset-xrp',
    symbol: 'XRP',
    name: 'Ripple',
    decimals: 6,
    isEnabled: true,
    sortOrder: 4,
    badgeColor: '#23292F',
    description: 'Cross-border settlement asset requiring destination tag verification.',
  },
  {
    id: 'asset-ltc',
    symbol: 'LTC',
    name: 'Litecoin',
    decimals: 8,
    isEnabled: true,
    sortOrder: 5,
    badgeColor: '#345D9D',
    description: 'UTXO-based peer-to-peer payment network asset.',
  },
  {
    id: 'asset-bch',
    symbol: 'BCH',
    name: 'Bitcoin Cash',
    decimals: 8,
    isEnabled: true,
    sortOrder: 6,
    badgeColor: '#0AC18E',
    description: 'UTXO electronic cash protocol asset.',
  },
  {
    id: 'asset-trx',
    symbol: 'TRX',
    name: 'TRON',
    decimals: 6,
    isEnabled: true,
    sortOrder: 7,
    badgeColor: '#EF0027',
    description: 'TRON network native gas and settlement asset.',
  },
  {
    id: 'asset-sol',
    symbol: 'SOL',
    name: 'Solana',
    decimals: 6,
    isEnabled: true,
    sortOrder: 8,
    badgeColor: '#14F195',
    description: 'High-throughput Layer 1 network settlement asset.',
  },
];

export const INITIAL_NETWORKS: NetworkConfig[] = [
  {
    id: 'net-usdt-trc20',
    code: 'TRC-20',
    name: 'TRON (TRC-20)',
    assetSymbol: 'USDT',
    requiredConfirmations: 20,
    minDeposit: 10,
    minWithdrawal: 20,
    networkFee: 1.0,
    platformFee: 0.0,
    addressPattern: '^T[1-9A-HJ-NP-Za-km-z]{33}$',
    memoRequired: false,
    isDepositEnabled: true,
    isWithdrawalEnabled: true,
    updatedAt: '2026-11-15T00:00:00Z',
  },
  {
    id: 'net-usdt-erc20',
    code: 'ERC-20',
    name: 'Ethereum (ERC-20)',
    assetSymbol: 'USDT',
    requiredConfirmations: 12,
    minDeposit: 25,
    minWithdrawal: 50,
    networkFee: 4.5,
    platformFee: 0.0,
    addressPattern: '^0x[a-fA-F0-9]{40}$',
    memoRequired: false,
    isDepositEnabled: true,
    isWithdrawalEnabled: true,
    updatedAt: '2026-11-15T00:00:00Z',
  },
  {
    id: 'net-btc-mainnet',
    code: 'BTC',
    name: 'Bitcoin Network',
    assetSymbol: 'BTC',
    requiredConfirmations: 3,
    minDeposit: 0.0005,
    minWithdrawal: 0.001,
    networkFee: 0.00015,
    platformFee: 0.0,
    addressPattern: '^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$',
    memoRequired: false,
    isDepositEnabled: true,
    isWithdrawalEnabled: true,
    updatedAt: '2026-11-15T00:00:00Z',
  },
  {
    id: 'net-eth-mainnet',
    code: 'ETH',
    name: 'Ethereum Mainnet',
    assetSymbol: 'ETH',
    requiredConfirmations: 12,
    minDeposit: 0.01,
    minWithdrawal: 0.02,
    networkFee: 0.002,
    platformFee: 0.0,
    addressPattern: '^0x[a-fA-F0-9]{40}$',
    memoRequired: false,
    isDepositEnabled: true,
    isWithdrawalEnabled: true,
    updatedAt: '2026-11-15T00:00:00Z',
  },
  {
    id: 'net-sol-mainnet',
    code: 'SOL',
    name: 'Solana Mainnet',
    assetSymbol: 'SOL',
    requiredConfirmations: 32,
    minDeposit: 0.1,
    minWithdrawal: 0.2,
    networkFee: 0.01,
    platformFee: 0.0,
    addressPattern: '^[1-9A-HJ-NP-Za-km-z]{32,44}$',
    memoRequired: false,
    isDepositEnabled: true,
    isWithdrawalEnabled: true,
    updatedAt: '2026-11-15T00:00:00Z',
  },
  {
    id: 'net-xrp-ledger',
    code: 'XRP',
    name: 'XRP Ledger',
    assetSymbol: 'XRP',
    requiredConfirmations: 1,
    minDeposit: 10,
    minWithdrawal: 20,
    networkFee: 0.25,
    platformFee: 0.0,
    addressPattern: '^r[1-9A-HJ-NP-Za-km-z]{24,34}$',
    memoRequired: true,
    isDepositEnabled: true,
    isWithdrawalEnabled: true,
    updatedAt: '2026-11-15T00:00:00Z',
  },
];

export const INITIAL_TRADING_PAIRS: TradingPair[] = [
  { id: 'pair-btc', symbol: 'BTC/USDT', baseAsset: 'BTC', quoteAsset: 'USDT', feeRate: 0.001, minOrderUsdt: 10, venueSymbol: 'BTCUSDT', isEnabled: true },
  { id: 'pair-eth', symbol: 'ETH/USDT', baseAsset: 'ETH', quoteAsset: 'USDT', feeRate: 0.001, minOrderUsdt: 10, venueSymbol: 'ETHUSDT', isEnabled: true },
  { id: 'pair-xrp', symbol: 'XRP/USDT', baseAsset: 'XRP', quoteAsset: 'USDT', feeRate: 0.001, minOrderUsdt: 10, venueSymbol: 'XRPUSDT', isEnabled: true },
  { id: 'pair-ltc', symbol: 'LTC/USDT', baseAsset: 'LTC', quoteAsset: 'USDT', feeRate: 0.001, minOrderUsdt: 10, venueSymbol: 'LTCUSDT', isEnabled: true },
  { id: 'pair-bch', symbol: 'BCH/USDT', baseAsset: 'BCH', quoteAsset: 'USDT', feeRate: 0.001, minOrderUsdt: 10, venueSymbol: 'BCHUSDT', isEnabled: true },
  { id: 'pair-trx', symbol: 'TRX/USDT', baseAsset: 'TRX', quoteAsset: 'USDT', feeRate: 0.001, minOrderUsdt: 10, venueSymbol: 'TRXUSDT', isEnabled: true },
  { id: 'pair-sol', symbol: 'SOL/USDT', baseAsset: 'SOL', quoteAsset: 'USDT', feeRate: 0.001, minOrderUsdt: 10, venueSymbol: 'SOLUSDT', isEnabled: true },
];

/**
 * Market prices remain unavailable (price: 0) until a real market data provider
 * is connected in Phase C. Never fabricate synthetic prices or candle series.
 */
export const INITIAL_MARKET_PRICES: MarketPrice[] = INITIAL_TRADING_PAIRS.map((p) => ({
  symbol: p.symbol,
  price: 0,
  change24hPct: 0,
  high24h: 0,
  low24h: 0,
  volume24h: 0,
  dataStatus: 'unavailable',
  updatedAt: '2026-11-15T00:00:00Z',
  candles: [],
}));

export const INITIAL_MARKET_SETTINGS: MarketSettings = {
  providerName: 'Live Feed Not Connected',
  providerStatus: 'unavailable',
  refreshIntervalSeconds: 5,
  lastSyncedAt: '2026-11-15T00:00:00Z',
};

/**
 * Operator role accounts only — zero pre-funded customer balances or fabricated trades.
 */
export const INITIAL_PROFILES: Profile[] = [
  {
    id: 'admin-1',
    publicUserId: '9000000001',
    email: 'super.admin@exchange.local',
    fullName: 'Operations Supervisor',
    phone: '+440000000001',
    twoFactorEnabled: true,
    accountStatus: 'active',
    kycStatus: 'approved',
    preferredLanguage: 'English',
    createdAt: '2026-11-01T08:00:00Z',
  },
  {
    id: 'admin-2',
    publicUserId: '9000000002',
    email: 'finance.admin@exchange.local',
    fullName: 'Finance Controller',
    phone: '+440000000002',
    twoFactorEnabled: true,
    accountStatus: 'active',
    kycStatus: 'approved',
    preferredLanguage: 'English',
    createdAt: '2026-11-01T08:00:00Z',
  },
  {
    id: 'admin-3',
    publicUserId: '9000000003',
    email: 'compliance.admin@exchange.local',
    fullName: 'Compliance Officer',
    phone: '+440000000003',
    twoFactorEnabled: true,
    accountStatus: 'active',
    kycStatus: 'approved',
    preferredLanguage: 'English',
    createdAt: '2026-11-01T08:00:00Z',
  },
];

export const INITIAL_USER_ROLES: UserRoleRecord[] = [
  { id: 'role-admin-1', userId: 'admin-1', role: 'super_admin', assignedBy: 'system', createdAt: '2026-11-01T08:00:00Z' },
  { id: 'role-admin-2', userId: 'admin-2', role: 'finance_admin', assignedBy: 'admin-1', createdAt: '2026-11-01T08:00:00Z' },
  { id: 'role-admin-3', userId: 'admin-3', role: 'compliance_admin', assignedBy: 'admin-1', createdAt: '2026-11-01T08:00:00Z' },
];

export const INITIAL_WALLET_BALANCES: WalletBalance[] = [];
export const INITIAL_DEPOSIT_ADDRESSES: DepositAddress[] = [];
export const INITIAL_DEPOSITS: DepositRecord[] = [];
export const INITIAL_WITHDRAWALS: WithdrawalRequest[] = [];
export const INITIAL_KYC_SUBMISSIONS: KycSubmission[] = [];
export const INITIAL_SPOT_ORDERS: SpotOrder[] = [];
export const INITIAL_TRADES: Trade[] = [];
export const INITIAL_LEDGER_TRANSACTIONS: LedgerTransaction[] = [];
export const INITIAL_LEDGER_ENTRIES: LedgerEntry[] = [];
export const INITIAL_NOTIFICATION_CAMPAIGNS: NotificationCampaign[] = [];
export const INITIAL_NOTIFICATIONS: NotificationItem[] = [];
export const INITIAL_AUDIT_LOGS: AdminAuditLog[] = [];
export const INITIAL_RECEIVING_ADDRESSES: ReceivingAddress[] = [];
export const INITIAL_MANUAL_PURCHASE_ORDERS: ManualPurchaseOrder[] = [];

export const INITIAL_RECONCILIATION_RUNS: ReconciliationRun[] = [
  {
    id: 'rec-init-1',
    scope: 'ledger_vs_balances',
    assetSymbol: 'ALL',
    expectedTotal: 0,
    observedTotal: 0,
    discrepancy: 0,
    status: 'matched',
    details: 'Initial Phase A baseline: zero customer liabilities and zero fabricated balances.',
    createdAt: '2026-11-15T00:00:00Z',
  },
  {
    id: 'rec-init-2',
    scope: 'ledger_vs_custody',
    assetSymbol: 'ALL',
    expectedTotal: 0,
    observedTotal: 0,
    discrepancy: 0,
    status: 'unconfigured',
    details: 'Custody on-chain vault balance verification activates in Phase D.',
    createdAt: '2026-11-15T00:00:00Z',
  },
];
