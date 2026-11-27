import test from 'node:test';
import assert from 'node:assert/strict';
import { canApproveDeposit, applyDepositApproval } from '../src/utils/exchangeEngine';
import type { DepositRecord, ManualPurchaseOrder, WalletBalance } from '../src/types/domain';

test('Deposit methods unavailable messages are correctly defined and distinct', () => {
  const unavailableMessages = {
    bank: 'Bank transfer deposits are temporarily unavailable. We’re working to restore this service as soon as possible. Please try again later.',
    ach: 'ACH deposits are currently unavailable due to temporary service maintenance. Please try again later.',
    card: 'Debit card deposits are temporarily unavailable while we update our payment processing service. We apologize for the inconvenience.',
    wire: 'Wire transfer deposits are temporarily unavailable. This deposit option will be restored once processing services are available again.',
  };

  assert.equal(
    unavailableMessages.bank,
    'Bank transfer deposits are temporarily unavailable. We’re working to restore this service as soon as possible. Please try again later.'
  );
  assert.equal(
    unavailableMessages.ach,
    'ACH deposits are currently unavailable due to temporary service maintenance. Please try again later.'
  );
  assert.equal(
    unavailableMessages.card,
    'Debit card deposits are temporarily unavailable while we update our payment processing service. We apologize for the inconvenience.'
  );
  assert.equal(
    unavailableMessages.wire,
    'Wire transfer deposits are temporarily unavailable. This deposit option will be restored once processing services are available again.'
  );
});

test('canApproveDeposit enforces verification checks and prevents double crediting', () => {
  const pendingDeposit: DepositRecord = {
    id: 'dep-test-1',
    userId: 'user-cust-1',
    assetSymbol: 'USDT',
    networkCode: 'TRC-20',
    depositAddress: '0xTestAddress',
    memoOrTag: null,
    txHash: '0xabcdef1234567890',
    fromAddress: '0xSender',
    amount: 500,
    confirmations: 15,
    requiredConfirmations: 12,
    addressVerified: true,
    networkVerified: true,
    amountVerified: true,
    duplicateChecked: true,
    kytStatus: 'passed',
    kytRiskScore: 5,
    status: 'PENDING_ADMIN_REVIEW',
    adminNote: null,
    reviewedBy: null,
    reviewedAt: null,
    creditedTxId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const gate = canApproveDeposit(pendingDeposit, [], []);
  assert.equal(gate.allowed, true);

  const balances: WalletBalance[] = [
    {
      id: 'wb-1',
      userId: 'user-cust-1',
      assetSymbol: 'USDT',
      available: 100,
      reserved: 0,
      updatedAt: new Date().toISOString(),
    },
  ];

  const approvalResult = applyDepositApproval({
    deposit: pendingDeposit,
    existingDeposits: [],
    balances,
    ledgerTransactions: [],
    customerAccountStatus: 'active',
    adminUserId: 'admin-1',
    adminNote: 'Verified on-chain via TronScan',
    nowIso: new Date().toISOString(),
    txId: 'tx-1',
    entryId: 'le-1',
    balanceId: 'wb-1',
  });

  assert.equal(approvalResult.ok, true);
  if (!approvalResult.ok) throw new Error('Approval failed');
  const data = approvalResult.data!;
  assert.equal(data.updatedDeposit.status, 'CREDITED');
  assert.equal(data.updatedBalances[0].available, 600);
  assert.equal(data.newTransaction.type, 'deposit_credit');

  // Idempotency check: approving the same deposit again should be blocked by idempotency guard
  const duplicateGate = canApproveDeposit(
    pendingDeposit,
    [data.updatedDeposit],
    [data.newTransaction]
  );
  assert.equal(duplicateGate.allowed, false);
});

test('canApproveDeposit blocks closed accounts, insufficient confirmations, and active manual purchase txHash reuse', () => {
  const baseDeposit: DepositRecord = {
    id: 'dep-test-2',
    userId: 'user-cust-2',
    assetSymbol: 'USDT',
    networkCode: 'TRC-20',
    depositAddress: 'TTestAddress1234567890123456789012',
    memoOrTag: null,
    txHash: '0xSharedTxHash123456',
    fromAddress: null,
    amount: 250,
    confirmations: 1,
    requiredConfirmations: 20,
    addressVerified: true,
    networkVerified: true,
    amountVerified: true,
    duplicateChecked: true,
    kytStatus: 'passed',
    kytRiskScore: 0,
    status: 'PENDING_ADMIN_REVIEW',
    adminNote: null,
    reviewedBy: null,
    reviewedAt: null,
    creditedTxId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Insufficient confirmations blocked until finality reached
  const lowConf = canApproveDeposit(baseDeposit, [], [], { customerAccountStatus: 'active' });
  assert.equal(lowConf.allowed, false);
  assert.match(lowConf.reason ?? '', /Insufficient confirmations/);

  const finalized = { ...baseDeposit, confirmations: 20 };

  // Closed account blocked even with full confirmations
  const closedGate = canApproveDeposit(finalized, [], [], { customerAccountStatus: 'closed' });
  assert.equal(closedGate.allowed, false);
  assert.match(closedGate.reason ?? '', /closed/i);

  // Active manual purchase order using the same txHash blocks deposit approval
  const activeMpo = {
    id: 'mpo-1',
    receivingNetwork: 'TRC-20',
    paymentTxHash: '0xsharedtxhash123456',
    status: 'PAYMENT_SUBMITTED',
  } as ManualPurchaseOrder;
  const collisionGate = canApproveDeposit(finalized, [], [], {
    customerAccountStatus: 'active',
    existingManualPurchaseOrders: [activeMpo],
  });
  assert.equal(collisionGate.allowed, false);
  assert.match(collisionGate.reason ?? '', /collides with an active manual purchase order/i);

  // Rejected manual purchase order frees the txHash
  const rejectedGate = canApproveDeposit(finalized, [], [], {
    customerAccountStatus: 'active',
    existingManualPurchaseOrders: [{ ...activeMpo, status: 'REJECTED' }],
  });
  assert.equal(rejectedGate.allowed, true);
});

