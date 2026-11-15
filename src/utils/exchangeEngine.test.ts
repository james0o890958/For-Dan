import test from 'node:test';
import assert from 'node:assert/strict';
import type { DepositRecord, NetworkConfig, WalletBalance, WithdrawalRequest } from '../types/domain';
import {
  applyDepositApproval,
  applyWithdrawalApprovalDecision,
  canApproveDeposit,
  finalizeWithdrawalCompletion,
  previewWithdrawal,
  refundReservedWithdrawal,
} from './exchangeEngine';

const TRC20_NET: NetworkConfig = {
  id: 'net-trc20',
  code: 'TRC-20',
  name: 'TRON (TRC-20)',
  assetSymbol: 'USDT',
  requiredConfirmations: 20,
  minDeposit: 10,
  minWithdrawal: 20,
  networkFee: 1,
  platformFee: 0.5,
  addressPattern: '^T[1-9A-HJ-NP-Za-km-z]{33}$',
  memoRequired: false,
  isDepositEnabled: true,
  isWithdrawalEnabled: true,
  updatedAt: '2026-11-15T00:00:00Z',
};

function makeVerifiedDeposit(overrides: Partial<DepositRecord> = {}): DepositRecord {
  return {
    id: 'dep-1',
    userId: 'cust-1',
    assetSymbol: 'USDT',
    networkCode: 'TRC-20',
    depositAddress: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
    memoOrTag: null,
    txHash: '0xabc123def456',
    fromAddress: 'TExternalSender111111111111111111111',
    amount: 500,
    confirmations: 20,
    requiredConfirmations: 20,
    addressVerified: true,
    networkVerified: true,
    amountVerified: true,
    duplicateChecked: true,
    kytStatus: 'passed',
    kytRiskScore: 0.5,
    status: 'PENDING_ADMIN_REVIEW',
    adminNote: null,
    reviewedBy: null,
    reviewedAt: null,
    creditedTxId: null,
    createdAt: '2026-11-15T00:00:00Z',
    updatedAt: '2026-11-15T00:05:00Z',
    ...overrides,
  };
}

test('canApproveDeposit blocks unconfirmed or screenshot-only deposits', () => {
  const lowConf = makeVerifiedDeposit({ confirmations: 5 });
  assert.equal(canApproveDeposit(lowConf, [lowConf], []).allowed, false);

  const unverifiedAddr = makeVerifiedDeposit({ addressVerified: false });
  assert.equal(canApproveDeposit(unverifiedAddr, [unverifiedAddr], []).allowed, false);

  const flaggedKyt = makeVerifiedDeposit({ kytStatus: 'flagged' });
  assert.equal(canApproveDeposit(flaggedKyt, [flaggedKyt], []).allowed, false);
});

test('applyDepositApproval credits customer balance exactly once and blocks duplicates', () => {
  const dep = makeVerifiedDeposit();
  const initialBalances: WalletBalance[] = [
    {
      id: 'bal-1',
      userId: 'cust-1',
      assetSymbol: 'USDT',
      available: 0,
      reserved: 0,
      updatedAt: '2026-11-15T00:00:00Z',
    },
  ];

  const first = applyDepositApproval({
    deposit: dep,
    existingDeposits: [dep],
    balances: initialBalances,
    ledgerTransactions: [],
    adminUserId: 'admin-1',
    adminNote: 'Verified on-chain',
    nowIso: '2026-11-15T00:10:00Z',
    txId: 'ltx-1',
    entryId: 'le-1',
    balanceId: 'bal-1',
  });

  assert.equal(first.ok, true);
  assert.equal(first.data?.updatedDeposit.status, 'CREDITED');
  assert.equal(first.data?.updatedBalances[0].available, 500);

  // Duplicate transaction check must block a second credit for the same deposit or same txHash
  const second = applyDepositApproval({
    deposit: first.data!.updatedDeposit,
    existingDeposits: [first.data!.updatedDeposit],
    balances: first.data!.updatedBalances,
    ledgerTransactions: [first.data!.newTransaction],
    adminUserId: 'admin-1',
    adminNote: 'Retry',
    nowIso: '2026-11-15T00:11:00Z',
    txId: 'ltx-2',
    entryId: 'le-2',
    balanceId: 'bal-1',
  });
  assert.equal(second.ok, false);
});

test('previewWithdrawal enforces 2FA, valid address, fees, and dual approval for high-value payouts', () => {
  const invalidAddr = previewWithdrawal({
    accountStatus: 'active',
    kycStatus: 'approved',
    twoFactorEnabled: true,
    twoFactorCode: '123456',
    network: TRC20_NET,
    destinationAddress: '0xNotATronAddress',
    grossAmount: 100,
    availableBalance: 500,
    estimatedUsdtPrice: 1,
  });
  assert.equal(invalidAddr.valid, false);

  const highValue = previewWithdrawal({
    accountStatus: 'active',
    kycStatus: 'approved',
    twoFactorEnabled: true,
    twoFactorCode: '123456',
    network: TRC20_NET,
    destinationAddress: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
    grossAmount: 6000,
    availableBalance: 10000,
    estimatedUsdtPrice: 1,
  });
  assert.equal(highValue.valid, true);
  assert.equal(highValue.netReceived, 5998.5);
  assert.equal(highValue.riskLevel, 'high');
  assert.equal(highValue.requiredApprovals, 2);
});

test('withdrawal dual-approval blocks same admin twice, settles only after finality, and refunds on failure', () => {
  const baseWithdrawal: WithdrawalRequest = {
    id: 'wd-1',
    userId: 'cust-1',
    assetSymbol: 'USDT',
    networkCode: 'TRC-20',
    destinationAddress: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
    memoOrTag: null,
    grossAmount: 6000,
    networkFee: 1,
    platformFee: 0.5,
    netAmount: 5998.5,
    twoFactorVerified: true,
    riskLevel: 'high',
    kytStatus: 'passed',
    requiredApprovals: 2,
    approvals: [],
    custodyTxId: null,
    txHash: null,
    confirmations: 0,
    requiredConfirmations: 20,
    status: 'PENDING_ADMIN_APPROVAL',
    failureReason: null,
    rejectionReason: null,
    idempotencyKey: 'wd-idem-1',
    createdAt: '2026-11-15T00:00:00Z',
    updatedAt: '2026-11-15T00:00:00Z',
  };

  const firstApproval = applyWithdrawalApprovalDecision({
    withdrawal: baseWithdrawal,
    adminUserId: 'admin-1',
    adminLabel: 'Claire Vance',
    adminRole: 'super_admin',
    decision: 'approved',
    note: 'First review ok',
    nowIso: '2026-11-15T00:01:00Z',
  });
  assert.equal(firstApproval.ok, true);
  assert.equal(firstApproval.data?.status, 'PENDING_ADMIN_APPROVAL');

  const duplicateAdmin = applyWithdrawalApprovalDecision({
    withdrawal: firstApproval.data!,
    adminUserId: 'admin-1',
    adminLabel: 'Claire Vance',
    adminRole: 'super_admin',
    decision: 'approved',
    note: 'Self second approve',
    nowIso: '2026-11-15T00:02:00Z',
  });
  assert.equal(duplicateAdmin.ok, false);

  const secondApproval = applyWithdrawalApprovalDecision({
    withdrawal: firstApproval.data!,
    adminUserId: 'admin-3',
    adminLabel: 'Priya Nair',
    adminRole: 'finance_admin',
    decision: 'approved',
    note: 'Second approval ok',
    nowIso: '2026-11-15T00:03:00Z',
  });
  assert.equal(secondApproval.ok, true);
  assert.equal(secondApproval.data?.status, 'APPROVED');

  const reservedBalances: WalletBalance[] = [
    {
      id: 'bal-1',
      userId: 'cust-1',
      assetSymbol: 'USDT',
      available: 4000,
      reserved: 6000,
      updatedAt: '2026-11-15T00:00:00Z',
    },
  ];

  // Confirming without finality must fail
  const confirmingTooEarly: WithdrawalRequest = {
    ...secondApproval.data!,
    status: 'CONFIRMING',
    txHash: '0xwdtx1',
    confirmations: 4,
  };
  assert.equal(
    finalizeWithdrawalCompletion({
      withdrawal: confirmingTooEarly,
      balances: reservedBalances,
      txId: 'ltx-wd-1',
      entryId: 'le-wd-1',
      nowIso: '2026-11-15T00:05:00Z',
    }).ok,
    false
  );

  // Finality reached -> COMPLETED and reserved debited
  const confirmingReady: WithdrawalRequest = {
    ...confirmingTooEarly,
    confirmations: 20,
  };
  const settled = finalizeWithdrawalCompletion({
    withdrawal: confirmingReady,
    balances: reservedBalances,
    txId: 'ltx-wd-1',
    entryId: 'le-wd-1',
    nowIso: '2026-11-15T00:06:00Z',
  });
  assert.equal(settled.ok, true);
  assert.equal(settled.data?.updatedWithdrawal.status, 'COMPLETED');
  assert.equal(settled.data?.updatedBalances[0].reserved, 0);
  assert.equal(settled.data?.updatedBalances[0].available, 4000);

  // Failure refund restores available balance from reserved
  const refunded = refundReservedWithdrawal({
    withdrawal: { ...secondApproval.data!, status: 'FAILED' },
    targetStatus: 'REFUNDED',
    reason: 'Custody broadcast rejected by network',
    balances: reservedBalances,
    txId: 'ltx-ref-1',
    releaseEntryId: 'le-rel-1',
    creditEntryId: 'le-cred-1',
    nowIso: '2026-11-15T00:07:00Z',
  });
  assert.equal(refunded.ok, true);
  assert.equal(refunded.data?.updatedWithdrawal.status, 'REFUNDED');
  assert.equal(refunded.data?.updatedBalances[0].reserved, 0);
  assert.equal(refunded.data?.updatedBalances[0].available, 10000);
});
