import type {
  AppRole,
  LedgerTransactionType,
  MarketDataStatus,
  NotificationCategory,
  NotificationRecipientType,
  Profile,
  TradeSide,
} from '../types/domain';

export interface RegisterInput {
  fullName: string;
  email: string;
  phone?: string;
  password: string;
  preferredLanguage: string;
}

export interface SpotTradeInput {
  pairSymbol: string;
  side: TradeSide;
  amountInput: number;
}

export interface WithdrawalRequestInput {
  assetSymbol: string;
  networkCode: string;
  destinationAddress: string;
  memoOrTag?: string;
  grossAmount: number;
  twoFactorCode: string;
}

export interface LedgerAdjustmentInput {
  publicUserId: string;
  assetSymbol: string;
  direction: 'credit' | 'debit';
  amount: number;
  sourceAccount: string;
  reasonCode: string;
  reversalOfTxId?: string;
  summaryNote: string;
}

export interface SendCampaignInput {
  title: string;
  message: string;
  category: NotificationCategory;
  recipientType: NotificationRecipientType;
  recipientUserIds: string[];
  filterSummary: string;
}

export interface ExchangeServiceHelpers {
  generateId(prefix: string): string;
  generatePublicUserId(existing: Profile[]): string;
  getRoleLabel(role: AppRole): string;
  getLedgerTypeLabel(type: LedgerTransactionType): string;
  isTradingFeedReady(status: MarketDataStatus): boolean;
}

export const exchangeService: ExchangeServiceHelpers = {
  generateId(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  },
  generatePublicUserId(existing: Profile[]) {
    const used = new Set(existing.map((p) => p.publicUserId));
    let candidate = String(6087700500 + existing.length * 17);
    while (used.has(candidate)) {
      candidate = String(Number(candidate) + 1);
    }
    return candidate;
  },
  getRoleLabel(role: AppRole) {
    switch (role) {
      case 'super_admin':
        return 'Super Admin';
      case 'operations_admin':
        return 'Operations Admin';
      case 'finance_admin':
        return 'Finance Admin';
      case 'compliance_admin':
        return 'Compliance Admin';
      default:
        return 'Customer';
    }
  },
  getLedgerTypeLabel(type: LedgerTransactionType) {
    switch (type) {
      case 'deposit_credit':
        return 'Deposit Credit';
      case 'withdrawal_reserve':
        return 'Withdrawal Reserve';
      case 'withdrawal_release':
        return 'Withdrawal Release';
      case 'withdrawal_settle':
        return 'Withdrawal Settle';
      case 'withdrawal_refund':
        return 'Withdrawal Refund';
      case 'spot_buy':
        return 'Spot Buy';
      case 'spot_sell':
        return 'Spot Sell';
      case 'trading_fee':
        return 'Trading Fee';
      case 'adjustment':
        return 'Ledger Adjustment';
      case 'reversal':
        return 'Ledger Reversal';
    }
  },
  isTradingFeedReady(status: MarketDataStatus) {
    return status === 'live' || status === 'delayed';
  },
};
