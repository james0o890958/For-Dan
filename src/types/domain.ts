export type AccountStatus = 'active' | 'suspended' | 'closed';
export type KycStatus = 'not_submitted' | 'pending' | 'approved' | 'rejected';
export type AppRole =
  | 'customer'
  | 'super_admin'
  | 'operations_admin'
  | 'finance_admin'
  | 'compliance_admin';

export type MarketDataStatus = 'live' | 'delayed' | 'unavailable';

export type LedgerTransactionType =
  | 'deposit_credit'
  | 'withdrawal_reserve'
  | 'withdrawal_release'
  | 'withdrawal_settle'
  | 'withdrawal_refund'
  | 'spot_buy'
  | 'spot_sell'
  | 'trading_fee'
  | 'adjustment'
  | 'reversal';

export type DepositStatus =
  | 'PENDING_DETECTION'
  | 'DETECTED'
  | 'AWAITING_CONFIRMATIONS'
  | 'PENDING_ADMIN_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'CREDITED';

export type WithdrawalStatus =
  | 'REQUESTED'
  | 'RISK_REVIEW'
  | 'PENDING_ADMIN_APPROVAL'
  | 'APPROVED'
  | 'PROCESSING'
  | 'BROADCAST'
  | 'CONFIRMING'
  | 'COMPLETED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'FAILED'
  | 'REFUNDED';

export type SpotOrderStatus = 'SUBMITTED' | 'PARTIALLY_FILLED' | 'FILLED' | 'REJECTED';
export type TradeSide = 'buy' | 'sell';
export type KytStatus = 'pending' | 'passed' | 'flagged';
export type RiskLevel = 'low' | 'medium' | 'high';
export type LedgerBucket = 'available' | 'reserved' | 'platform_fee' | 'omnibus';

export type NotificationRecipientType = 'everyone' | 'selected_group' | 'individual';
export type NotificationCategory =
  | 'Account'
  | 'Deposit'
  | 'Withdrawal'
  | 'KYC'
  | 'Market'
  | 'Compliance'
  | 'Notice';

export interface Profile {
  id: string;
  publicUserId: string;
  email: string;
  fullName: string;
  phone: string | null;
  twoFactorEnabled: boolean;
  accountStatus: AccountStatus;
  kycStatus: KycStatus;
  preferredLanguage: string;
  createdAt: string;
}

export interface UserRoleRecord {
  id: string;
  userId: string;
  role: AppRole;
  assignedBy: string;
  createdAt: string;
}

export interface KycSubmission {
  id: string;
  userId: string;
  providerName: string;
  sanctionsStatus: 'pending' | 'clear' | 'match';
  livenessPassed: boolean;
  fullName: string;
  country: string;
  documentType: 'National ID' | 'Passport' | 'Driver License';
  documentNumber: string;
  submittedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface Asset {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  isEnabled: boolean;
  sortOrder: number;
  badgeColor: string;
  description: string;
}

export interface NetworkConfig {
  id: string;
  code: string;
  name: string;
  assetSymbol: string;
  requiredConfirmations: number;
  minDeposit: number;
  minWithdrawal: number;
  networkFee: number;
  platformFee: number;
  addressPattern: string;
  memoRequired: boolean;
  isDepositEnabled: boolean;
  isWithdrawalEnabled: boolean;
  updatedAt: string;
}

export interface TradingPair {
  id: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  feeRate: number;
  minOrderUsdt: number;
  venueSymbol: string;
  isEnabled: boolean;
}

export type MarketTimeframe = '15M' | '1H' | '4H' | '1D' | '1W';

export interface CandlePoint {
  timestamp?: number;
  timeLabel: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketPrice {
  symbol: string;
  price: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  dataStatus: MarketDataStatus;
  updatedAt: string;
  candles: CandlePoint[];
}

export interface OrderBookLevel {
  price: number;
  size: number;
  total: number;
  totalUsdt: number;
  depthPct: number;
}

export interface OrderBookSnapshot {
  symbol: string;
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
  bestAsk: number;
  bestBid: number;
  midPrice: number;
  spreadUsdt: number;
  spreadPct: number;
  updatedAt: string;
}

export interface PublicMarketTrade {
  id: string;
  symbol: string;
  price: number;
  quantity: number;
  quoteAmount: number;
  side: TradeSide;
  timestamp: string;
}

export interface WalletBalance {
  id: string;
  userId: string;
  assetSymbol: string;
  available: number;
  reserved: number;
  updatedAt: string;
}

export interface DepositAddress {
  id: string;
  userId: string;
  assetSymbol: string;
  networkCode: string;
  custodyVaultId: string;
  address: string;
  memoOrTag: string | null;
  createdAt: string;
}

export interface DepositRecord {
  id: string;
  userId: string;
  assetSymbol: string;
  networkCode: string;
  depositAddress: string;
  memoOrTag: string | null;
  txHash: string;
  fromAddress: string | null;
  amount: number;
  confirmations: number;
  requiredConfirmations: number;
  addressVerified: boolean;
  networkVerified: boolean;
  amountVerified: boolean;
  duplicateChecked: boolean;
  kytStatus: KytStatus;
  kytRiskScore: number | null;
  status: DepositStatus;
  adminNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  creditedTxId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WithdrawalApproval {
  adminUserId: string;
  adminLabel: string;
  role: AppRole;
  decision: 'approved' | 'rejected';
  note: string;
  createdAt: string;
}

export interface WithdrawalRequest {
  id: string;
  userId: string;
  assetSymbol: string;
  networkCode: string;
  destinationAddress: string;
  memoOrTag: string | null;
  grossAmount: number;
  networkFee: number;
  platformFee: number;
  netAmount: number;
  twoFactorVerified: boolean;
  riskLevel: RiskLevel;
  kytStatus: KytStatus;
  requiredApprovals: 1 | 2;
  approvals: WithdrawalApproval[];
  custodyTxId: string | null;
  txHash: string | null;
  confirmations: number;
  requiredConfirmations: number;
  status: WithdrawalStatus;
  failureReason: string | null;
  rejectionReason: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface SpotOrder {
  id: string;
  userId: string;
  pairSymbol: string;
  side: TradeSide;
  orderType: 'MARKET' | 'LIMIT';
  limitPrice?: number | null;
  requestedAmount: number;
  reservedAsset: string;
  reservedAmount: number;
  filledBaseQty: number;
  filledQuoteAmount: number;
  feeUsdt: number;
  venueName: string | null;
  venueOrderId: string | null;
  status: SpotOrderStatus;
  rejectReason: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface Trade {
  id: string;
  orderId: string;
  userId: string;
  pairSymbol: string;
  side: TradeSide;
  baseAsset: string;
  quoteAsset: string;
  executedPrice: number;
  baseQuantity: number;
  quoteAmount: number;
  feeUsdt: number;
  totalUsdt: number;
  venueTradeId: string;
  createdAt: string;
}

export interface LedgerTransaction {
  id: string;
  userId: string;
  type: LedgerTransactionType;
  referenceId: string;
  idempotencyKey: string;
  sourceAccount: string;
  reasonCode: string | null;
  reversalOfTxId: string | null;
  summary: string;
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  transactionId: string;
  userId: string;
  assetSymbol: string;
  bucket: LedgerBucket;
  deltaAmount: number;
  balanceAfter: number;
  entryRole: string;
  createdAt: string;
}

export interface NotificationCampaign {
  id: string;
  title: string;
  message: string;
  category: NotificationCategory;
  recipientType: NotificationRecipientType;
  filterSummary: string;
  recipientCount: number;
  createdBy: string;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  campaignId: string;
  userId: string;
  title: string;
  message: string;
  category: NotificationCategory;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface AdminAuditLog {
  id: string;
  adminUserId: string;
  adminLabel: string;
  action: string;
  affectedUserId: string | null;
  affectedPublicUserId: string | null;
  recordType: string;
  recordId: string;
  details: string;
  createdAt: string;
}

export interface MarketSettings {
  providerName: string;
  providerStatus: MarketDataStatus;
  refreshIntervalSeconds: number;
  lastSyncedAt: string;
}

export type ProviderConnectionStatus = 'not_configured' | 'connected' | 'degraded' | 'offline';

export interface ProviderHealth {
  id: string;
  name: string;
  category: 'custody' | 'liquidity' | 'market_data' | 'kyt_indexer' | 'kyc_sanctions';
  status: ProviderConnectionStatus;
  requiredPhase: 'Phase B' | 'Phase C' | 'Phase D';
  details: string;
  lastCheckedAt: string | null;
}

export interface ReconciliationRun {
  id: string;
  scope: 'ledger_vs_balances' | 'ledger_vs_custody' | 'trades_vs_venue';
  assetSymbol: string | null;
  expectedTotal: number;
  observedTotal: number;
  discrepancy: number;
  status: 'matched' | 'mismatch' | 'unconfigured';
  details: string;
  createdAt: string;
}
