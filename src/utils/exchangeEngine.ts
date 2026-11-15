import type {
  AccountStatus,
  AppRole,
  DepositRecord,
  KycStatus,
  LedgerEntry,
  LedgerTransaction,
  NetworkConfig,
  RiskLevel,
  WalletBalance,
  WithdrawalRequest,
} from '../types/domain';
import { roundAmount } from './tradingMath';

export interface EngineResult<T> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface WithdrawalQuote {
  valid: boolean;
  error: string | null;
  grossAmount: number;
  networkFee: number;
  platformFee: number;
  netReceived: number;
  riskLevel: RiskLevel;
  requiredApprovals: 1 | 2;
}

const HIGH_RISK_USDT_EQUIVALENT = 5000;

export function assessWithdrawalRisk(params: {
  assetSymbol: string;
  grossAmount: number;
  estimatedUsdtPrice: number;
  twoFactorVerified: boolean;
}): { riskLevel: RiskLevel; requiredApprovals: 1 | 2 } {
  const usdtValue =
    params.assetSymbol === 'USDT'
      ? params.grossAmount
      : params.grossAmount * Math.max(params.estimatedUsdtPrice, 0);

  if (!params.twoFactorVerified || usdtValue >= HIGH_RISK_USDT_EQUIVALENT) {
    return { riskLevel: 'high', requiredApprovals: 2 };
  }
  if (usdtValue >= 1000) {
    return { riskLevel: 'medium', requiredApprovals: 1 };
  }
  return { riskLevel: 'low', requiredApprovals: 1 };
}

export function previewWithdrawal(params: {
  accountStatus: AccountStatus;
  kycStatus: KycStatus;
  twoFactorEnabled: boolean;
  twoFactorCode: string;
  network: NetworkConfig | undefined;
  destinationAddress: string;
  memoOrTag?: string;
  grossAmount: number;
  availableBalance: number;
  estimatedUsdtPrice: number;
}): WithdrawalQuote {
  const empty: WithdrawalQuote = {
    valid: false,
    error: null,
    grossAmount: 0,
    networkFee: params.network?.networkFee ?? 0,
    platformFee: params.network?.platformFee ?? 0,
    netReceived: 0,
    riskLevel: 'low',
    requiredApprovals: 1,
  };

  if (params.accountStatus === 'suspended') {
    return { ...empty, error: 'Account is suspended. Withdrawals are disabled.' };
  }
  if (params.kycStatus !== 'approved') {
    return { ...empty, error: 'Approved KYC verification is required before withdrawing.' };
  }
  if (!params.network || !params.network.isWithdrawalEnabled) {
    return { ...empty, error: 'Selected withdrawal network is currently disabled.' };
  }
  const addr = params.destinationAddress.trim();
  if (!addr) {
    return { ...empty, error: 'Enter a destination wallet address.' };
  }
  const regex = new RegExp(params.network.addressPattern);
  if (!regex.test(addr)) {
    return {
      ...empty,
      error: `Destination address does not match ${params.network.code} format.`,
    };
  }
  if (params.network.memoRequired && !params.memoOrTag?.trim()) {
    return { ...empty, error: `Destination tag/memo is required for ${params.network.code}.` };
  }
  if (!Number.isFinite(params.grossAmount) || params.grossAmount <= 0) {
    return { ...empty, error: 'Enter a valid positive withdrawal amount.' };
  }
  if (params.grossAmount < params.network.minWithdrawal) {
    return {
      ...empty,
      error: `Minimum withdrawal on ${params.network.code} is ${params.network.minWithdrawal} ${params.network.assetSymbol}.`,
    };
  }
  if (params.grossAmount > params.availableBalance) {
    return { ...empty, error: 'Insufficient available balance.' };
  }

  const totalFees = roundAmount(params.network.networkFee + params.network.platformFee, 8);
  const netReceived = roundAmount(params.grossAmount - totalFees, 8);
  if (netReceived <= 0) {
    return {
      ...empty,
      error: 'Withdrawal amount must exceed applicable network and platform fees.',
    };
  }

  if (!params.twoFactorEnabled) {
    return {
      ...empty,
      error: 'Enable Two-Factor Authentication (2FA) in Settings before requesting withdrawals.',
    };
  }
  if (!/^\d{6}$/.test(params.twoFactorCode.trim())) {
    return { ...empty, error: 'Enter a valid 6-digit 2FA confirmation code.' };
  }

  const risk = assessWithdrawalRisk({
    assetSymbol: params.network.assetSymbol,
    grossAmount: params.grossAmount,
    estimatedUsdtPrice: params.estimatedUsdtPrice,
    twoFactorVerified: true,
  });

  return {
    valid: true,
    error: null,
    grossAmount: roundAmount(params.grossAmount, 8),
    networkFee: params.network.networkFee,
    platformFee: params.network.platformFee,
    netReceived,
    riskLevel: risk.riskLevel,
    requiredApprovals: risk.requiredApprovals,
  };
}

/**
 * Pure verification check for blockchain deposits.
 * Screenshot-only approvals are explicitly forbidden: txHash, network, address,
 * amount, confirmations, duplicate check, and KYT screening must all pass.
 */
export function canApproveDeposit(
  deposit: DepositRecord,
  existingDeposits: DepositRecord[],
  existingLedgerTransactions: LedgerTransaction[]
): { allowed: boolean; reason: string | null } {
  if (deposit.status !== 'PENDING_ADMIN_REVIEW') {
    return {
      allowed: false,
      reason: `Deposit must be in PENDING_ADMIN_REVIEW state (current: ${deposit.status}).`,
    };
  }
  if (!deposit.txHash.trim()) {
    return { allowed: false, reason: 'Verified blockchain transaction hash is required.' };
  }
  if (!deposit.addressVerified || !deposit.networkVerified || !deposit.amountVerified) {
    return {
      allowed: false,
      reason: 'Destination address, network, and amount verification checks must all pass.',
    };
  }
  if (!deposit.duplicateChecked) {
    return { allowed: false, reason: 'Duplicate transaction check has not passed.' };
  }
  const duplicateTx = existingDeposits.some(
    (d) =>
      d.id !== deposit.id &&
      d.networkCode === deposit.networkCode &&
      d.txHash.toLowerCase() === deposit.txHash.toLowerCase() &&
      (d.status === 'APPROVED' || d.status === 'CREDITED')
  );
  if (duplicateTx) {
    return { allowed: false, reason: 'Duplicate blockchain transaction hash detected.' };
  }
  if (deposit.confirmations < deposit.requiredConfirmations) {
    return {
      allowed: false,
      reason: `Insufficient confirmations (${deposit.confirmations}/${deposit.requiredConfirmations}).`,
    };
  }
  if (deposit.kytStatus !== 'passed') {
    return {
      allowed: false,
      reason: `KYT screening must pass before approval (current: ${deposit.kytStatus}).`,
    };
  }
  const idempotencyKey = `dep-approve-${deposit.id}`;
  if (existingLedgerTransactions.some((t) => t.idempotencyKey === idempotencyKey)) {
    return { allowed: false, reason: 'Deposit already credited (idempotency guard).' };
  }
  return { allowed: true, reason: null };
}

export function applyDepositApproval(params: {
  deposit: DepositRecord;
  existingDeposits: DepositRecord[];
  balances: WalletBalance[];
  ledgerTransactions: LedgerTransaction[];
  adminUserId: string;
  adminNote: string;
  nowIso: string;
  txId: string;
  entryId: string;
  balanceId: string;
}): EngineResult<{
  updatedDeposit: DepositRecord;
  updatedBalances: WalletBalance[];
  newTransaction: LedgerTransaction;
  newEntry: LedgerEntry;
}> {
  const gate = canApproveDeposit(
    params.deposit,
    params.existingDeposits,
    params.ledgerTransactions
  );
  if (!gate.allowed) {
    return { ok: false, error: gate.reason ?? 'Deposit verification failed.' };
  }

  const currentBal = params.balances.find(
    (b) => b.userId === params.deposit.userId && b.assetSymbol === params.deposit.assetSymbol
  );
  const nextAvailable = roundAmount((currentBal?.available ?? 0) + params.deposit.amount, 8);

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
          userId: params.deposit.userId,
          assetSymbol: params.deposit.assetSymbol,
          available: nextAvailable,
          reserved: 0,
          updatedAt: params.nowIso,
        },
      ];

  const newTransaction: LedgerTransaction = {
    id: params.txId,
    userId: params.deposit.userId,
    type: 'deposit_credit',
    referenceId: params.deposit.id,
    idempotencyKey: `dep-approve-${params.deposit.id}`,
    sourceAccount: `custody_deposit_${params.deposit.networkCode}`,
    reasonCode: 'ONCHAIN_DEPOSIT_VERIFIED',
    reversalOfTxId: null,
    summary: `Verified deposit credited: ${params.deposit.amount} ${params.deposit.assetSymbol} (${params.deposit.networkCode}, tx ${params.deposit.txHash.slice(0, 10)}...)`,
    createdAt: params.nowIso,
  };

  const newEntry: LedgerEntry = {
    id: params.entryId,
    transactionId: params.txId,
    userId: params.deposit.userId,
    assetSymbol: params.deposit.assetSymbol,
    bucket: 'available',
    deltaAmount: params.deposit.amount,
    balanceAfter: nextAvailable,
    entryRole: 'credit_verified_deposit',
    createdAt: params.nowIso,
  };

  const updatedDeposit: DepositRecord = {
    ...params.deposit,
    status: 'CREDITED',
    adminNote: params.adminNote.trim() || 'On-chain verification passed; credited once.',
    reviewedBy: params.adminUserId,
    reviewedAt: params.nowIso,
    creditedTxId: params.txId,
    updatedAt: params.nowIso,
  };

  return {
    ok: true,
    data: {
      updatedDeposit,
      updatedBalances,
      newTransaction,
      newEntry,
    },
  };
}

export function applyWithdrawalApprovalDecision(params: {
  withdrawal: WithdrawalRequest;
  adminUserId: string;
  adminLabel: string;
  adminRole: AppRole;
  decision: 'approved' | 'rejected';
  note: string;
  nowIso: string;
}): EngineResult<WithdrawalRequest> {
  if (params.withdrawal.status !== 'PENDING_ADMIN_APPROVAL') {
    return {
      ok: false,
      error: `Withdrawal cannot be reviewed in status ${params.withdrawal.status}.`,
    };
  }
  if (
    params.withdrawal.approvals.some((a) => a.adminUserId === params.adminUserId)
  ) {
    return {
      ok: false,
      error: 'Dual control rule: the same administrator cannot approve the same withdrawal twice.',
    };
  }
  if (params.decision === 'rejected' && !params.note.trim()) {
    return {
      ok: false,
      error: 'A rejection reason is required.',
    };
  }

  const nextApprovals = [
    ...params.withdrawal.approvals,
    {
      adminUserId: params.adminUserId,
      adminLabel: params.adminLabel,
      role: params.adminRole,
      decision: params.decision,
      note: params.note.trim(),
      createdAt: params.nowIso,
    },
  ];

  if (params.decision === 'rejected') {
    return {
      ok: true,
      data: {
        ...params.withdrawal,
        approvals: nextApprovals,
        status: 'REJECTED',
        rejectionReason: params.note.trim(),
        updatedAt: params.nowIso,
      },
    };
  }

  const approvedCount = nextApprovals.filter((a) => a.decision === 'approved').length;
  const nextStatus =
    approvedCount >= params.withdrawal.requiredApprovals
      ? 'APPROVED'
      : 'PENDING_ADMIN_APPROVAL';

  return {
    ok: true,
    data: {
      ...params.withdrawal,
      approvals: nextApprovals,
      status: nextStatus,
      updatedAt: params.nowIso,
    },
  };
}

export function finalizeWithdrawalCompletion(params: {
  withdrawal: WithdrawalRequest;
  balances: WalletBalance[];
  txId: string;
  entryId: string;
  nowIso: string;
}): EngineResult<{
  updatedWithdrawal: WithdrawalRequest;
  updatedBalances: WalletBalance[];
  newTransaction: LedgerTransaction;
  newEntry: LedgerEntry;
}> {
  const w = params.withdrawal;
  if (w.status !== 'CONFIRMING') {
    return {
      ok: false,
      error: `Withdrawal must be CONFIRMING before completion (current: ${w.status}).`,
    };
  }
  if (!w.txHash?.trim()) {
    return { ok: false, error: 'Cannot complete withdrawal without broadcast txHash.' };
  }
  if (w.confirmations < w.requiredConfirmations) {
    return {
      ok: false,
      error: `Cannot complete withdrawal before network finality (${w.confirmations}/${w.requiredConfirmations}).`,
    };
  }

  const bal = params.balances.find(
    (b) => b.userId === w.userId && b.assetSymbol === w.assetSymbol
  );
  if (!bal || bal.reserved < w.grossAmount) {
    return { ok: false, error: 'Reserved balance is insufficient for settlement.' };
  }

  const nextReserved = roundAmount(bal.reserved - w.grossAmount, 8);
  const updatedBalances = params.balances.map((b) =>
    b.id === bal.id ? { ...b, reserved: nextReserved, updatedAt: params.nowIso } : b
  );

  const newTransaction: LedgerTransaction = {
    id: params.txId,
    userId: w.userId,
    type: 'withdrawal_settle',
    referenceId: w.id,
    idempotencyKey: `wd-settle-${w.id}`,
    sourceAccount: `custody_hot_${w.networkCode}`,
    reasonCode: 'ONCHAIN_WITHDRAWAL_FINALIZED',
    reversalOfTxId: null,
    summary: `Withdrawal settled: ${w.netAmount} ${w.assetSymbol} + ${roundAmount(w.networkFee + w.platformFee, 8)} fee (${w.networkCode})`,
    createdAt: params.nowIso,
  };

  const newEntry: LedgerEntry = {
    id: params.entryId,
    transactionId: params.txId,
    userId: w.userId,
    assetSymbol: w.assetSymbol,
    bucket: 'reserved',
    deltaAmount: -w.grossAmount,
    balanceAfter: nextReserved,
    entryRole: 'debit_reserved_withdrawal',
    createdAt: params.nowIso,
  };

  return {
    ok: true,
    data: {
      updatedWithdrawal: {
        ...w,
        status: 'COMPLETED',
        updatedAt: params.nowIso,
      },
      updatedBalances,
      newTransaction,
      newEntry,
    },
  };
}

export function refundReservedWithdrawal(params: {
  withdrawal: WithdrawalRequest;
  targetStatus: 'CANCELLED' | 'REJECTED' | 'REFUNDED';
  reason: string;
  balances: WalletBalance[];
  txId: string;
  releaseEntryId: string;
  creditEntryId: string;
  nowIso: string;
}): EngineResult<{
  updatedWithdrawal: WithdrawalRequest;
  updatedBalances: WalletBalance[];
  newTransaction: LedgerTransaction;
  newEntries: LedgerEntry[];
}> {
  const w = params.withdrawal;
  const bal = params.balances.find(
    (b) => b.userId === w.userId && b.assetSymbol === w.assetSymbol
  );
  if (!bal || bal.reserved < w.grossAmount) {
    return { ok: false, error: 'Reserved balance missing for withdrawal release/refund.' };
  }

  const nextReserved = roundAmount(bal.reserved - w.grossAmount, 8);
  const nextAvailable = roundAmount(bal.available + w.grossAmount, 8);
  const updatedBalances = params.balances.map((b) =>
    b.id === bal.id
      ? { ...b, available: nextAvailable, reserved: nextReserved, updatedAt: params.nowIso }
      : b
  );

  const txType =
    params.targetStatus === 'REFUNDED' ? 'withdrawal_refund' : 'withdrawal_release';

  const newTransaction: LedgerTransaction = {
    id: params.txId,
    userId: w.userId,
    type: txType,
    referenceId: w.id,
    idempotencyKey: `wd-${params.targetStatus.toLowerCase()}-${w.id}`,
    sourceAccount: 'customer_reserved',
    reasonCode: params.targetStatus,
    reversalOfTxId: null,
    summary: `Withdrawal ${params.targetStatus.toLowerCase()}: ${w.grossAmount} ${w.assetSymbol} returned to available (${params.reason})`,
    createdAt: params.nowIso,
  };

  const newEntries: LedgerEntry[] = [
    {
      id: params.releaseEntryId,
      transactionId: params.txId,
      userId: w.userId,
      assetSymbol: w.assetSymbol,
      bucket: 'reserved',
      deltaAmount: -w.grossAmount,
      balanceAfter: nextReserved,
      entryRole: 'release_withdrawal_reserve',
      createdAt: params.nowIso,
    },
    {
      id: params.creditEntryId,
      transactionId: params.txId,
      userId: w.userId,
      assetSymbol: w.assetSymbol,
      bucket: 'available',
      deltaAmount: w.grossAmount,
      balanceAfter: nextAvailable,
      entryRole: 'restore_available_balance',
      createdAt: params.nowIso,
    },
  ];

  return {
    ok: true,
    data: {
      updatedWithdrawal: {
        ...w,
        status: params.targetStatus,
        failureReason: params.targetStatus === 'REFUNDED' ? params.reason : w.failureReason,
        rejectionReason: params.targetStatus === 'REJECTED' ? params.reason : w.rejectionReason,
        updatedAt: params.nowIso,
      },
      updatedBalances,
      newTransaction,
      newEntries,
    },
  };
}
