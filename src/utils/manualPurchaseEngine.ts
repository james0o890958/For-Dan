import type {
  AccountStatus,
  AppRole,
  Asset,
  DepositRecord,
  KycStatus,
  LedgerEntry,
  LedgerTransaction,
  ManualPurchaseOrder,
  ManualPurchaseOrderReviewEvent,
  ManualPurchaseOrderStatus,
  ManualPurchaseVerificationChecklist,
  NetworkConfig,
  ReceivingAddress,
  TradingPair,
  TradeSide,
  WalletBalance,
} from '../types/domain';
import type { EngineResult } from './exchangeEngine';
import { roundAmount } from './tradingMath';

export const MAX_MANUAL_PURCHASE_USDT = 250_000;

export const MANUAL_PURCHASE_INTERNAL_LEDGER_DISCLOSURE =
  'Crediting this order records an internal platform ledger balance (customer liability). Internal wallet credits do not independently constitute proof of external custody reserve or on-chain backing.';

export const MANUAL_PURCHASE_ADMIN_REVIEW_ROLES: ReadonlySet<AppRole> = new Set([
  'super_admin',
  'finance_admin',
  'operations_admin',
  'compliance_admin',
]);

export const MANUAL_PURCHASE_ADMIN_FULFIL_ROLES: ReadonlySet<AppRole> = new Set([
  'super_admin',
  'finance_admin',
]);

export const ALLOWED_MANUAL_PURCHASE_TRANSITIONS: Record<
  ManualPurchaseOrderStatus,
  readonly ManualPurchaseOrderStatus[]
> = {
  PENDING_PAYMENT: ['CANCELLED', 'REJECTED'],
  PAYMENT_SUBMITTED: ['UNDER_REVIEW', 'REJECTED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['COMPLETED', 'REJECTED'],
  REJECTED: [],
  COMPLETED: [],
  CANCELLED: [],
};

export interface ManualPurchaseQuote {
  valid: boolean;
  error: string | null;
  pairSymbol: string;
  baseAsset: string;
  quoteAsset: string;
  orderType: 'MARKET' | 'LIMIT';
  effectivePrice: number;
  limitPrice: number | null;
  referencePrice: number;
  requestedQuoteAmount: number;
  feeRate: number;
  estimatedFeeUsdt: number;
  estimatedCryptoAmount: number;
  totalPaymentAmount: number;
}

export function isTerminalManualPurchaseStatus(status: ManualPurchaseOrderStatus): boolean {
  return status === 'COMPLETED' || status === 'REJECTED' || status === 'CANCELLED';
}

export function canTransitionManualPurchaseStatus(
  from: ManualPurchaseOrderStatus,
  to: ManualPurchaseOrderStatus
): boolean {
  return ALLOWED_MANUAL_PURCHASE_TRANSITIONS[from].includes(to);
}

export function normalizeTxHash(txHash: string): string {
  return txHash.trim();
}

export function isValidPaymentTxHash(txHash: string): boolean {
  const cleaned = normalizeTxHash(txHash);
  if (cleaned.length < 10 || cleaned.length > 160) return false;
  if (/\s/.test(cleaned)) return false;
  return /^[A-Za-z0-9:_-]+$/.test(cleaned);
}

export function hasDuplicatePaymentTxHash(params: {
  txHash: string;
  networkCode: string;
  excludeOrderId?: string;
  existingOrders: ManualPurchaseOrder[];
  existingDeposits?: DepositRecord[];
}): boolean {
  const normalized = normalizeTxHash(params.txHash).toLowerCase();
  if (!normalized) return false;
  const network = params.networkCode.trim().toUpperCase();

  const orderDup = params.existingOrders.some(
    (o) =>
      o.id !== params.excludeOrderId &&
      o.receivingNetwork.trim().toUpperCase() === network &&
      o.paymentTxHash !== null &&
      o.paymentTxHash.trim().toLowerCase() === normalized &&
      o.status !== 'REJECTED' &&
      o.status !== 'CANCELLED'
  );
  if (orderDup) return true;

  if (params.existingDeposits) {
    return params.existingDeposits.some(
      (d) =>
        d.networkCode.trim().toUpperCase() === network &&
        d.txHash.trim().toLowerCase() === normalized &&
        (d.status === 'APPROVED' || d.status === 'CREDITED')
    );
  }

  return false;
}

export function calculateManualPurchaseQuote(params: {
  side: TradeSide | string;
  orderType: 'MARKET' | 'LIMIT' | 'stop_limit' | string;
  pair: TradingPair | undefined;
  baseAsset: Asset | undefined;
  quoteAsset: Asset | undefined;
  requestedQuoteAmount: number;
  limitPrice?: number | null;
  referenceMarketPrice: number;
  accountStatus: AccountStatus;
  kycStatus: KycStatus;
  receivingAddress: ReceivingAddress | undefined;
  networkConfig: NetworkConfig | undefined;
}): ManualPurchaseQuote {
  const empty: ManualPurchaseQuote = {
    valid: false,
    error: null,
    pairSymbol: params.pair?.symbol ?? '',
    baseAsset: params.pair?.baseAsset ?? '',
    quoteAsset: params.pair?.quoteAsset ?? 'USDT',
    orderType: params.orderType === 'LIMIT' ? 'LIMIT' : 'MARKET',
    effectivePrice: 0,
    limitPrice: null,
    referencePrice: params.referenceMarketPrice,
    requestedQuoteAmount: 0,
    feeRate: params.pair?.feeRate ?? 0,
    estimatedFeeUsdt: 0,
    estimatedCryptoAmount: 0,
    totalPaymentAmount: 0,
  };

  if (params.side !== 'buy') {
    return {
      ...empty,
      error: 'Manual trade fulfilment supports BUY cryptocurrency purchase orders only.',
    };
  }

  if (params.orderType !== 'MARKET' && params.orderType !== 'LIMIT') {
    return {
      ...empty,
      error: 'Manual purchase requests support Market or Limit buy orders only (Stop-Limit is preview-only).',
    };
  }

  if (params.accountStatus !== 'active') {
    return {
      ...empty,
      error:
        params.accountStatus === 'closed'
          ? 'Account is closed. Purchase requests are disabled.'
          : 'Account is suspended. Purchase requests are disabled.',
    };
  }

  if (params.kycStatus !== 'approved') {
    return {
      ...empty,
      error: 'Approved KYC verification is required before submitting a manual crypto purchase order.',
    };
  }

  if (!params.pair || !params.pair.isEnabled || !params.baseAsset?.isEnabled || !params.quoteAsset?.isEnabled) {
    return { ...empty, error: 'Selected trading pair or asset is currently disabled.' };
  }

  if (!params.receivingAddress) {
    return {
      ...empty,
      error: 'No active admin-configured cryptocurrency receiving address is available for the selected payment network.',
    };
  }

  if (!params.receivingAddress.isActive) {
    return {
      ...empty,
      error: 'Selected receiving address is disabled and cannot be assigned to new purchase orders.',
    };
  }

  if (params.networkConfig && !params.networkConfig.isDepositEnabled) {
    return {
      ...empty,
      error: `Payment network ${params.networkConfig.code} is currently disabled for inbound transfers.`,
    };
  }

  const quoteAmount = Number(params.requestedQuoteAmount);
  if (!Number.isFinite(quoteAmount) || quoteAmount <= 0) {
    return { ...empty, error: 'Enter a valid positive payment amount.' };
  }

  if (quoteAmount < params.pair.minOrderUsdt) {
    return {
      ...empty,
      error: `Minimum purchase order value is ${params.pair.minOrderUsdt.toFixed(2)} ${params.pair.quoteAsset}.`,
    };
  }

  if (quoteAmount > MAX_MANUAL_PURCHASE_USDT) {
    return {
      ...empty,
      error: `Single manual purchase order limit is ${MAX_MANUAL_PURCHASE_USDT.toLocaleString('en-US')} ${params.pair.quoteAsset}.`,
    };
  }

  const refPrice = Number(params.referenceMarketPrice);
  const parsedLimit = params.orderType === 'LIMIT' ? Number(params.limitPrice ?? 0) : null;

  if (params.orderType === 'LIMIT') {
    if (!Number.isFinite(parsedLimit) || (parsedLimit ?? 0) <= 0) {
      return { ...empty, error: 'Enter a valid positive limit price.' };
    }
  } else if (!Number.isFinite(refPrice) || refPrice <= 0) {
    return {
      ...empty,
      error: 'Reference market price is currently unavailable for market buy quotes.',
    };
  }

  const effectivePrice =
    params.orderType === 'LIMIT' ? roundAmount(parsedLimit!, 8) : roundAmount(refPrice, 8);

  const feeRate = Math.max(0, Math.min(0.05, params.pair.feeRate));
  const roundedQuote = roundAmount(quoteAmount, 8);
  const estimatedFeeUsdt = roundAmount(roundedQuote * feeRate, 8);
  const netForAsset = roundAmount(roundedQuote - estimatedFeeUsdt, 8);
  if (netForAsset <= 0) {
    return { ...empty, error: 'Order payment amount must exceed estimated fee.' };
  }
  const estimatedCryptoAmount = roundAmount(
    netForAsset / effectivePrice,
    Math.min(8, params.baseAsset.decimals)
  );
  if (!Number.isFinite(estimatedCryptoAmount) || estimatedCryptoAmount <= 0) {
    return { ...empty, error: 'Calculated crypto quantity is below supported asset precision.' };
  }

  return {
    valid: true,
    error: null,
    pairSymbol: params.pair.symbol,
    baseAsset: params.pair.baseAsset,
    quoteAsset: params.pair.quoteAsset,
    orderType: params.orderType,
    effectivePrice,
    limitPrice: params.orderType === 'LIMIT' ? effectivePrice : null,
    referencePrice: Number.isFinite(refPrice) && refPrice > 0 ? roundAmount(refPrice, 8) : effectivePrice,
    requestedQuoteAmount: roundedQuote,
    feeRate,
    estimatedFeeUsdt,
    estimatedCryptoAmount,
    totalPaymentAmount: roundedQuote,
  };
}

export function createManualPurchaseOrderRecord(params: {
  id: string;
  orderRef: string;
  eventId: string;
  userId: string;
  actorLabel: string;
  side: TradeSide | string;
  orderType: 'MARKET' | 'LIMIT' | 'stop_limit' | string;
  pair: TradingPair | undefined;
  baseAsset: Asset | undefined;
  quoteAsset: Asset | undefined;
  requestedQuoteAmount: number;
  limitPrice?: number | null;
  referenceMarketPrice: number;
  accountStatus: AccountStatus;
  kycStatus: KycStatus;
  receivingAddress: ReceivingAddress | undefined;
  networkConfig: NetworkConfig | undefined;
  nowIso: string;
}): EngineResult<ManualPurchaseOrder> {
  const quote = calculateManualPurchaseQuote({
    side: params.side,
    orderType: params.orderType,
    pair: params.pair,
    baseAsset: params.baseAsset,
    quoteAsset: params.quoteAsset,
    requestedQuoteAmount: params.requestedQuoteAmount,
    limitPrice: params.limitPrice,
    referenceMarketPrice: params.referenceMarketPrice,
    accountStatus: params.accountStatus,
    kycStatus: params.kycStatus,
    receivingAddress: params.receivingAddress,
    networkConfig: params.networkConfig,
  });

  if (!quote.valid || !params.receivingAddress) {
    return { ok: false, error: quote.error ?? 'Unable to create purchase order.' };
  }

  const initialEvent: ManualPurchaseOrderReviewEvent = {
    id: params.eventId,
    fromStatus: null,
    toStatus: 'PENDING_PAYMENT',
    actorUserId: params.userId,
    actorLabel: params.actorLabel,
    actorRole: 'customer',
    remark: `Purchase request created (${quote.orderType} BUY ${quote.estimatedCryptoAmount} ${quote.baseAsset} for ${quote.totalPaymentAmount} ${params.receivingAddress.assetSymbol} via ${params.receivingAddress.networkCode}).`,
    createdAt: params.nowIso,
  };

  const order: ManualPurchaseOrder = {
    id: params.id,
    orderRef: params.orderRef,
    userId: params.userId,
    pairSymbol: quote.pairSymbol,
    baseAsset: quote.baseAsset,
    quoteAsset: quote.quoteAsset,
    side: 'buy',
    orderType: quote.orderType,
    requestedQuoteAmount: quote.requestedQuoteAmount,
    limitPrice: quote.limitPrice,
    referencePrice: quote.referencePrice,
    feeRate: quote.feeRate,
    estimatedFeeUsdt: quote.estimatedFeeUsdt,
    estimatedCryptoAmount: quote.estimatedCryptoAmount,
    totalPaymentAmount: quote.totalPaymentAmount,
    paymentAsset: params.receivingAddress.assetSymbol,
    receivingNetwork: params.receivingAddress.networkCode,
    receivingAddressId: params.receivingAddress.id,
    receivingAddress: params.receivingAddress.address,
    receivingMemoOrTag: params.receivingAddress.memoOrTag,
    paymentTxHash: null,
    actualAmountSent: null,
    paymentNote: null,
    paymentSubmittedAt: null,
    status: 'PENDING_PAYMENT',
    verificationChecklist: {
      txHashChecked: false,
      addressMatched: false,
      networkMatched: false,
      amountVerified: false,
      duplicateClear: false,
    },
    finalCryptoAmount: null,
    finalFeeUsdt: null,
    adminRemark: null,
    rejectionReason: null,
    reviewedBy: null,
    reviewedAt: null,
    fulfilledBy: null,
    fulfilledAt: null,
    creditedTxId: null,
    idempotencyKey: `mpo-req-${params.id}`,
    version: 1,
    reviewHistory: [initialEvent],
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
  };

  return { ok: true, data: order };
}

export function submitManualPurchasePayment(params: {
  order: ManualPurchaseOrder;
  actorUserId: string;
  actorLabel: string;
  actorAccountStatus: AccountStatus;
  paymentTxHash: string;
  actualAmountSent: number;
  paymentNote?: string;
  existingOrders: ManualPurchaseOrder[];
  existingDeposits?: DepositRecord[];
  eventId: string;
  nowIso: string;
}): EngineResult<ManualPurchaseOrder> {
  const { order } = params;
  if (order.userId !== params.actorUserId) {
    return { ok: false, error: 'You are not authorized to submit payment details for this order.' };
  }
  if (params.actorAccountStatus !== 'active') {
    return { ok: false, error: 'Account is not active. Payment submission is disabled.' };
  }
  if (order.status !== 'PENDING_PAYMENT') {
    return {
      ok: false,
      error: `Payment details cannot be modified or resubmitted in status ${order.status}.`,
    };
  }
  if (order.paymentSubmittedAt !== null) {
    return { ok: false, error: 'Payment proof has already been submitted and locked for review.' };
  }

  const cleanedHash = normalizeTxHash(params.paymentTxHash);
  if (!isValidPaymentTxHash(cleanedHash)) {
    return {
      ok: false,
      error: 'Enter a valid blockchain transaction hash / payment reference (10–160 characters, no spaces).',
    };
  }

  const actualAmount = Number(params.actualAmountSent);
  if (!Number.isFinite(actualAmount) || actualAmount <= 0) {
    return { ok: false, error: 'Enter the actual positive amount sent.' };
  }

  if (
    hasDuplicatePaymentTxHash({
      txHash: cleanedHash,
      networkCode: order.receivingNetwork,
      excludeOrderId: order.id,
      existingOrders: params.existingOrders,
      existingDeposits: params.existingDeposits,
    })
  ) {
    return {
      ok: false,
      error: 'This transaction hash has already been submitted on this network and cannot be reused.',
    };
  }

  const trimmedNote = params.paymentNote?.trim() || null;
  if (trimmedNote && trimmedNote.length > 500) {
    return { ok: false, error: 'Payment note cannot exceed 500 characters.' };
  }

  const event: ManualPurchaseOrderReviewEvent = {
    id: params.eventId,
    fromStatus: 'PENDING_PAYMENT',
    toStatus: 'PAYMENT_SUBMITTED',
    actorUserId: params.actorUserId,
    actorLabel: params.actorLabel,
    actorRole: 'customer',
    remark: `Customer submitted payment reference ${cleanedHash.slice(0, 14)}... (${roundAmount(actualAmount, 8)} ${order.paymentAsset} on ${order.receivingNetwork}).`,
    createdAt: params.nowIso,
  };

  return {
    ok: true,
    data: {
      ...order,
      paymentTxHash: cleanedHash,
      actualAmountSent: roundAmount(actualAmount, 8),
      paymentNote: trimmedNote,
      paymentSubmittedAt: params.nowIso,
      status: 'PAYMENT_SUBMITTED',
      version: order.version + 1,
      reviewHistory: [...order.reviewHistory, event],
      updatedAt: params.nowIso,
    },
  };
}

export function cancelManualPurchaseOrderRecord(params: {
  order: ManualPurchaseOrder;
  actorUserId: string;
  actorLabel: string;
  reason?: string;
  eventId: string;
  nowIso: string;
}): EngineResult<ManualPurchaseOrder> {
  if (params.order.userId !== params.actorUserId) {
    return { ok: false, error: 'You are not authorized to cancel this order.' };
  }
  if (!canTransitionManualPurchaseStatus(params.order.status, 'CANCELLED')) {
    return {
      ok: false,
      error: `Orders in status ${params.order.status} cannot be cancelled directly by the customer.`,
    };
  }
  const remark = params.reason?.trim() || 'Cancelled by customer prior to payment submission.';
  const event: ManualPurchaseOrderReviewEvent = {
    id: params.eventId,
    fromStatus: params.order.status,
    toStatus: 'CANCELLED',
    actorUserId: params.actorUserId,
    actorLabel: params.actorLabel,
    actorRole: 'customer',
    remark,
    createdAt: params.nowIso,
  };

  return {
    ok: true,
    data: {
      ...params.order,
      status: 'CANCELLED',
      version: params.order.version + 1,
      reviewHistory: [...params.order.reviewHistory, event],
      updatedAt: params.nowIso,
    },
  };
}

export function reviewManualPurchaseOrderRecord(params: {
  order: ManualPurchaseOrder;
  adminUserId: string;
  adminLabel: string;
  adminRole: AppRole;
  targetStatus: 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
  checklist?: Partial<ManualPurchaseVerificationChecklist>;
  adminRemark?: string;
  rejectionReason?: string;
  expectedVersion?: number;
  existingOrders: ManualPurchaseOrder[];
  existingDeposits?: DepositRecord[];
  eventId: string;
  nowIso: string;
}): EngineResult<ManualPurchaseOrder> {
  if (!MANUAL_PURCHASE_ADMIN_REVIEW_ROLES.has(params.adminRole)) {
    return { ok: false, error: 'Administrative review privileges are required.' };
  }

  const { order } = params;
  if (params.expectedVersion !== undefined && order.version !== params.expectedVersion) {
    return {
      ok: false,
      error: 'Order was modified concurrently by another review action. Refresh and retry.',
    };
  }

  if (isTerminalManualPurchaseStatus(order.status)) {
    return {
      ok: false,
      error: `Order is already in terminal status ${order.status} and cannot be updated.`,
    };
  }

  if (!canTransitionManualPurchaseStatus(order.status, params.targetStatus)) {
    return {
      ok: false,
      error: `Invalid order status transition from ${order.status} to ${params.targetStatus}.`,
    };
  }

  const nextChecklist: ManualPurchaseVerificationChecklist = {
    txHashChecked: params.checklist?.txHashChecked ?? order.verificationChecklist.txHashChecked,
    addressMatched: params.checklist?.addressMatched ?? order.verificationChecklist.addressMatched,
    networkMatched: params.checklist?.networkMatched ?? order.verificationChecklist.networkMatched,
    amountVerified: params.checklist?.amountVerified ?? order.verificationChecklist.amountVerified,
    duplicateClear: params.checklist?.duplicateClear ?? order.verificationChecklist.duplicateClear,
  };

  const trimmedRemark = params.adminRemark?.trim() || order.adminRemark;

  if (params.targetStatus === 'REJECTED') {
    const reason = params.rejectionReason?.trim() ?? '';
    if (!reason) {
      return { ok: false, error: 'A clear rejection reason is required when rejecting an order.' };
    }
    const event: ManualPurchaseOrderReviewEvent = {
      id: params.eventId,
      fromStatus: order.status,
      toStatus: 'REJECTED',
      actorUserId: params.adminUserId,
      actorLabel: params.adminLabel,
      actorRole: params.adminRole,
      remark: `Rejected: ${reason}`,
      createdAt: params.nowIso,
    };
    return {
      ok: true,
      data: {
        ...order,
        status: 'REJECTED',
        verificationChecklist: nextChecklist,
        adminRemark: trimmedRemark,
        rejectionReason: reason,
        reviewedBy: params.adminUserId,
        reviewedAt: params.nowIso,
        version: order.version + 1,
        reviewHistory: [...order.reviewHistory, event],
        updatedAt: params.nowIso,
      },
    };
  }

  if (params.targetStatus === 'UNDER_REVIEW') {
    if (!order.paymentTxHash?.trim()) {
      return {
        ok: false,
        error: 'Cannot mark UNDER_REVIEW before customer submits payment transaction reference.',
      };
    }
    const event: ManualPurchaseOrderReviewEvent = {
      id: params.eventId,
      fromStatus: order.status,
      toStatus: 'UNDER_REVIEW',
      actorUserId: params.adminUserId,
      actorLabel: params.adminLabel,
      actorRole: params.adminRole,
      remark: params.adminRemark?.trim() || 'Admin started independent payment verification.',
      createdAt: params.nowIso,
    };
    return {
      ok: true,
      data: {
        ...order,
        status: 'UNDER_REVIEW',
        verificationChecklist: nextChecklist,
        adminRemark: trimmedRemark,
        reviewedBy: params.adminUserId,
        reviewedAt: params.nowIso,
        version: order.version + 1,
        reviewHistory: [...order.reviewHistory, event],
        updatedAt: params.nowIso,
      },
    };
  }

  // APPROVED check
  if (!order.paymentTxHash?.trim() || !order.paymentSubmittedAt) {
    return {
      ok: false,
      error: 'Cannot approve purchase order without submitted customer payment details.',
    };
  }

  if (
    !nextChecklist.txHashChecked ||
    !nextChecklist.addressMatched ||
    !nextChecklist.networkMatched ||
    !nextChecklist.amountVerified ||
    !nextChecklist.duplicateClear
  ) {
    return {
      ok: false,
      error:
        'All five verification checks (tx hash, receiving address, network, amount verified, and duplicate check) must pass before approving.',
    };
  }

  if (
    hasDuplicatePaymentTxHash({
      txHash: order.paymentTxHash,
      networkCode: order.receivingNetwork,
      excludeOrderId: order.id,
      existingOrders: params.existingOrders,
      existingDeposits: params.existingDeposits,
    })
  ) {
    return {
      ok: false,
      error: 'Duplicate transaction hash detected on this network. Approval blocked.',
    };
  }

  const event: ManualPurchaseOrderReviewEvent = {
    id: params.eventId,
    fromStatus: order.status,
    toStatus: 'APPROVED',
    actorUserId: params.adminUserId,
    actorLabel: params.adminLabel,
    actorRole: params.adminRole,
    remark:
      params.adminRemark?.trim() ||
      'Payment verified and approved for internal wallet ledger fulfilment.',
    createdAt: params.nowIso,
  };

  return {
    ok: true,
    data: {
      ...order,
      status: 'APPROVED',
      verificationChecklist: nextChecklist,
      adminRemark: trimmedRemark,
      reviewedBy: params.adminUserId,
      reviewedAt: params.nowIso,
      version: order.version + 1,
      reviewHistory: [...order.reviewHistory, event],
      updatedAt: params.nowIso,
    },
  };
}

export function fulfilManualPurchaseOrderRecord(params: {
  order: ManualPurchaseOrder;
  adminUserId: string;
  adminLabel: string;
  adminRole: AppRole;
  customerAccountStatus: AccountStatus;
  finalCryptoAmount?: number;
  finalFeeUsdt?: number;
  adminRemark?: string;
  expectedVersion?: number;
  existingOrders: ManualPurchaseOrder[];
  existingDeposits?: DepositRecord[];
  balances: WalletBalance[];
  ledgerTransactions: LedgerTransaction[];
  txId: string;
  entryId: string;
  balanceId: string;
  eventId: string;
  nowIso: string;
  beforeCommitHook?: () => { ok: boolean; error?: string };
}): EngineResult<{
  updatedOrder: ManualPurchaseOrder;
  updatedBalances: WalletBalance[];
  newTransaction: LedgerTransaction;
  newEntry: LedgerEntry;
}> {
  if (!MANUAL_PURCHASE_ADMIN_FULFIL_ROLES.has(params.adminRole)) {
    return {
      ok: false,
      error: 'Finance Admin or Super Admin authorization is required to fulfil orders and credit balances.',
    };
  }

  const { order } = params;

  if (params.expectedVersion !== undefined && order.version !== params.expectedVersion) {
    return {
      ok: false,
      error: 'Order state changed concurrently before fulfilment. Refresh and verify order state.',
    };
  }

  if (order.status !== 'APPROVED') {
    return {
      ok: false,
      error: `Order must be APPROVED before fulfilment (current: ${order.status}).`,
    };
  }

  if (order.creditedTxId !== null) {
    return {
      ok: false,
      error: 'Order has already been credited to a ledger transaction.',
    };
  }

  if (params.customerAccountStatus !== 'active') {
    return {
      ok: false,
      error: `Cannot credit internal wallet for ${params.customerAccountStatus} customer account.`,
    };
  }

  const idempotencyKey = `mpo-fulfil-${order.id}`;
  if (params.ledgerTransactions.some((t) => t.idempotencyKey === idempotencyKey)) {
    return {
      ok: false,
      error: 'Duplicate fulfilment blocked: ledger transaction already exists for this order.',
    };
  }

  if (!order.paymentTxHash?.trim()) {
    return { ok: false, error: 'Missing payment transaction hash on approved order.' };
  }

  if (
    hasDuplicatePaymentTxHash({
      txHash: order.paymentTxHash,
      networkCode: order.receivingNetwork,
      excludeOrderId: order.id,
      existingOrders: params.existingOrders,
      existingDeposits: params.existingDeposits,
    })
  ) {
    return {
      ok: false,
      error: 'Duplicate payment transaction hash detected on this network. Fulfilment blocked.',
    };
  }

  const finalAmount =
    params.finalCryptoAmount !== undefined
      ? roundAmount(Number(params.finalCryptoAmount), 8)
      : order.estimatedCryptoAmount;
  const finalFee =
    params.finalFeeUsdt !== undefined
      ? roundAmount(Number(params.finalFeeUsdt), 8)
      : order.estimatedFeeUsdt;

  if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
    return { ok: false, error: 'Final credited crypto quantity must be positive.' };
  }
  if (!Number.isFinite(finalFee) || finalFee < 0) {
    return { ok: false, error: 'Final fee cannot be negative.' };
  }

  const currentBal = params.balances.find(
    (b) => b.userId === order.userId && b.assetSymbol === order.baseAsset
  );
  const nextAvailable = roundAmount((currentBal?.available ?? 0) + finalAmount, 8);

  const updatedBalances: WalletBalance[] = currentBal
    ? params.balances.map((b) =>
        b.id === currentBal.id
          ? { ...b, available: nextAvailable, updatedAt: params.nowIso }
          : b
      )
    : [
        ...params.balances,
        {
          id: params.balanceId,
          userId: order.userId,
          assetSymbol: order.baseAsset,
          available: nextAvailable,
          reserved: 0,
          updatedAt: params.nowIso,
        },
      ];

  const newTransaction: LedgerTransaction = {
    id: params.txId,
    userId: order.userId,
    type: 'spot_buy',
    referenceId: order.id,
    idempotencyKey,
    sourceAccount: `manual_purchase_${order.receivingNetwork}`,
    reasonCode: 'MANUAL_CRYPTO_PURCHASE_FULFILLED',
    reversalOfTxId: null,
    summary: `Manual purchase ${order.orderRef} fulfilled: +${finalAmount} ${order.baseAsset} credited to internal ledger (ref tx ${order.paymentTxHash.slice(0, 10)}...)`,
    createdAt: params.nowIso,
  };

  const newEntry: LedgerEntry = {
    id: params.entryId,
    transactionId: params.txId,
    userId: order.userId,
    assetSymbol: order.baseAsset,
    bucket: 'available',
    deltaAmount: finalAmount,
    balanceAfter: nextAvailable,
    entryRole: 'credit_manual_crypto_purchase',
    createdAt: params.nowIso,
  };

  // Atomic commit gate: if ledger persistence fails, abort BEFORE marking order COMPLETED.
  if (params.beforeCommitHook) {
    const hookResult = params.beforeCommitHook();
    if (!hookResult.ok) {
      return {
        ok: false,
        error:
          hookResult.error ||
          'Ledger settlement transaction failed; order remains APPROVED and wallet balances were not modified.',
      };
    }
  }

  const event: ManualPurchaseOrderReviewEvent = {
    id: params.eventId,
    fromStatus: 'APPROVED',
    toStatus: 'COMPLETED',
    actorUserId: params.adminUserId,
    actorLabel: params.adminLabel,
    actorRole: params.adminRole,
    remark:
      params.adminRemark?.trim() ||
      `Fulfilled ${finalAmount} ${order.baseAsset} via internal ledger transaction ${params.txId}.`,
    createdAt: params.nowIso,
  };

  const updatedOrder: ManualPurchaseOrder = {
    ...order,
    status: 'COMPLETED',
    finalCryptoAmount: finalAmount,
    finalFeeUsdt: finalFee,
    adminRemark: params.adminRemark?.trim() || order.adminRemark,
    fulfilledBy: params.adminUserId,
    fulfilledAt: params.nowIso,
    creditedTxId: params.txId,
    version: order.version + 1,
    reviewHistory: [...order.reviewHistory, event],
    updatedAt: params.nowIso,
  };

  return {
    ok: true,
    data: {
      updatedOrder,
      updatedBalances,
      newTransaction,
      newEntry,
    },
  };
}

export function upsertReceivingAddressRecord(params: {
  id?: string;
  assetSymbol: string;
  networkCode: string;
  address: string;
  memoOrTag?: string | null;
  label?: string;
  isActive?: boolean;
  adminUserId: string;
  adminLabel: string;
  adminRole: AppRole;
  existingAddresses: ReceivingAddress[];
  networkConfig: NetworkConfig | undefined;
  nowIso: string;
}): EngineResult<ReceivingAddress> {
  if (!MANUAL_PURCHASE_ADMIN_REVIEW_ROLES.has(params.adminRole)) {
    return { ok: false, error: 'Admin permission required to configure receiving addresses.' };
  }
  const assetSymbol = params.assetSymbol.trim().toUpperCase();
  const networkCode = params.networkCode.trim().toUpperCase();
  const address = params.address.trim();
  const memoOrTag = params.memoOrTag?.trim() || null;
  const label = params.label?.trim() || `${assetSymbol} ${networkCode} Receiving Address`;

  if (!assetSymbol || !networkCode || !address) {
    return { ok: false, error: 'Asset, network, and receiving address are required.' };
  }

  if (params.networkConfig) {
    try {
      const regex = new RegExp(params.networkConfig.addressPattern);
      if (!regex.test(address)) {
        return {
          ok: false,
          error: `Address format does not match ${networkCode} validation rules.`,
        };
      }
    } catch {
      // Ignore malformed pattern gracefully
    }
    if (params.networkConfig.memoRequired && !memoOrTag) {
      return { ok: false, error: `Destination tag/memo is required for ${networkCode}.` };
    }
  }

  const duplicate = params.existingAddresses.some(
    (a) =>
      a.id !== params.id &&
      a.networkCode.toUpperCase() === networkCode &&
      a.address.toLowerCase() === address.toLowerCase() &&
      (a.memoOrTag ?? '') === (memoOrTag ?? '')
  );
  if (duplicate) {
    return {
      ok: false,
      error: 'This receiving address and memo combination is already registered on this network.',
    };
  }

  const existing = params.id ? params.existingAddresses.find((a) => a.id === params.id) : undefined;
  if (existing) {
    return {
      ok: true,
      data: {
        ...existing,
        assetSymbol,
        networkCode,
        address,
        memoOrTag,
        label,
        isActive: params.isActive ?? existing.isActive,
        updatedAt: params.nowIso,
        auditHistory: [
          ...existing.auditHistory,
          {
            action: 'updated',
            actorUserId: params.adminUserId,
            actorLabel: params.adminLabel,
            note: `Updated receiving address config (${address.slice(0, 12)}...).`,
            createdAt: params.nowIso,
          },
        ],
      },
    };
  }

  if (!params.id) {
    return { ok: false, error: 'Missing receiving address record identifier.' };
  }

  return {
    ok: true,
    data: {
      id: params.id,
      assetSymbol,
      networkCode,
      address,
      memoOrTag,
      label,
      isActive: params.isActive ?? true,
      assignedBy: params.adminUserId,
      assignedByLabel: params.adminLabel,
      createdAt: params.nowIso,
      updatedAt: params.nowIso,
      auditHistory: [
        {
          action: 'created',
          actorUserId: params.adminUserId,
          actorLabel: params.adminLabel,
          note: `Registered ${assetSymbol} (${networkCode}) receiving address.`,
          createdAt: params.nowIso,
        },
      ],
    },
  };
}

export function toggleReceivingAddressStatusRecord(params: {
  addressRecord: ReceivingAddress;
  nextIsActive: boolean;
  adminUserId: string;
  adminLabel: string;
  adminRole: AppRole;
  note?: string;
  nowIso: string;
}): EngineResult<ReceivingAddress> {
  if (!MANUAL_PURCHASE_ADMIN_REVIEW_ROLES.has(params.adminRole)) {
    return { ok: false, error: 'Admin permission required to toggle receiving address status.' };
  }
  const action = params.nextIsActive ? 'activated' : 'disabled';
  return {
    ok: true,
    data: {
      ...params.addressRecord,
      isActive: params.nextIsActive,
      updatedAt: params.nowIso,
      auditHistory: [
        ...params.addressRecord.auditHistory,
        {
          action,
          actorUserId: params.adminUserId,
          actorLabel: params.adminLabel,
          note:
            params.note?.trim() ||
            `Receiving address marked ${params.nextIsActive ? 'ACTIVE' : 'DISABLED'}.`,
          createdAt: params.nowIso,
        },
      ],
    },
  };
}
