import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateTreasuryFundingApproval,
  validateApprovalRequestTransition,
  validateTreasuryFundingTransition,
} from './treasuryApproval';

const BASE_TREASURY_RECORD = {
  id: 'tf-1',
  treasuryWalletId: 'tw-1',
  assetSymbol: 'USDT',
  networkCode: 'ERC-20',
  direction: 'fund_inventory',
  amount: '50000',
  requestedBy: 'ops-admin-1',
  note: 'Seed settlement float',
  idempotencyKey: 'idem-tf-1',
};

const BASE_APPROVAL_REQUEST = {
  id: 'ar-1',
  requestType: 'manual_balance_adjustment' as const,
  targetTable: 'wallet_balances',
  targetId: 'wb-1',
  payload: { asset: 'USDT', delta: '100' },
  reasonCode: 'RECONCILIATION_FIX',
  summary: 'Credit missing deposit delta',
  requestedBy: 'finance-admin-1',
  idempotencyKey: 'idem-ar-1',
};

test('Super Admin can approve and confirm their own treasury funding request', () => {
  const approve = evaluateTreasuryFundingApproval({
    requestedByUserId: 'super-admin-1',
    actorUserId: 'super-admin-1',
    actorRole: 'super_admin',
    actorAccountStatus: 'active',
    targetStatus: 'APPROVED',
  });
  assert.equal(approve.allowed, true);
  assert.equal(approve.code, 'ALLOWED');

  const confirm = evaluateTreasuryFundingApproval({
    requestedByUserId: 'super-admin-1',
    actorUserId: 'super-admin-1',
    actorRole: 'super_admin',
    actorAccountStatus: 'active',
    targetStatus: 'CONFIRMED',
  });
  assert.equal(confirm.allowed, true);
  assert.equal(confirm.code, 'ALLOWED');

  const step1 = validateTreasuryFundingTransition({
    previous: {
      ...BASE_TREASURY_RECORD,
      requestedBy: 'super-admin-1',
      status: 'PENDING_APPROVAL',
      approvedBy: null,
      rejectedBy: null,
      confirmedBy: null,
      decisionNote: null,
    },
    next: {
      ...BASE_TREASURY_RECORD,
      requestedBy: 'super-admin-1',
      status: 'APPROVED',
      approvedBy: 'super-admin-1',
      rejectedBy: null,
      confirmedBy: null,
      decisionNote: null,
    },
    actorUserId: 'super-admin-1',
    actorRole: 'super_admin',
    actorAccountStatus: 'active',
  });
  assert.equal(step1.allowed, true);

  const step2 = validateTreasuryFundingTransition({
    previous: {
      ...BASE_TREASURY_RECORD,
      requestedBy: 'super-admin-1',
      status: 'APPROVED',
      approvedBy: 'super-admin-1',
      rejectedBy: null,
      confirmedBy: null,
      decisionNote: null,
    },
    next: {
      ...BASE_TREASURY_RECORD,
      requestedBy: 'super-admin-1',
      status: 'CONFIRMED',
      approvedBy: 'super-admin-1',
      rejectedBy: null,
      confirmedBy: 'super-admin-1',
      decisionNote: null,
    },
    actorUserId: 'super-admin-1',
    actorRole: 'super_admin',
    actorAccountStatus: 'active',
  });
  assert.equal(step2.allowed, true);
});

test('Other administrators cannot approve or confirm their own treasury funding requests', () => {
  for (const role of ['finance_admin', 'operations_admin', 'compliance_admin'] as const) {
    for (const targetStatus of ['APPROVED', 'CONFIRMED'] as const) {
      const result = evaluateTreasuryFundingApproval({
        requestedByUserId: 'admin-self',
        actorUserId: 'admin-self',
        actorRole: role,
        actorAccountStatus: 'active',
        targetStatus,
      });
      assert.equal(result.allowed, false);
      assert.equal(result.code, 'SELF_APPROVAL_REQUIRES_SUPER_ADMIN');
      assert.equal(result.requiresDualControl, true);
    }
  }
});

test('A different authorized administrator can approve or confirm another admin treasury funding request', () => {
  const financeApprovesOps = evaluateTreasuryFundingApproval({
    requestedByUserId: 'ops-admin-1',
    actorUserId: 'finance-admin-2',
    actorRole: 'finance_admin',
    actorAccountStatus: 'active',
    targetStatus: 'APPROVED',
  });
  assert.equal(financeApprovesOps.allowed, true);
  assert.equal(financeApprovesOps.code, 'ALLOWED');

  const superApprovesFinance = evaluateTreasuryFundingApproval({
    requestedByUserId: 'finance-admin-2',
    actorUserId: 'super-admin-1',
    actorRole: 'super_admin',
    actorAccountStatus: 'active',
    targetStatus: 'CONFIRMED',
  });
  assert.equal(superApprovesFinance.allowed, true);
  assert.equal(superApprovesFinance.code, 'ALLOWED');
});

test('Customer, suspended, or closed admin accounts cannot approve or confirm treasury funding requests', () => {
  const customer = evaluateTreasuryFundingApproval({
    requestedByUserId: 'ops-admin-1',
    actorUserId: 'cust-1',
    actorRole: 'customer',
    actorAccountStatus: 'active',
    targetStatus: 'APPROVED',
  });
  assert.equal(customer.allowed, false);
  assert.equal(customer.code, 'UNAUTHORIZED_ROLE');

  const suspendedSuper = evaluateTreasuryFundingApproval({
    requestedByUserId: 'super-admin-1',
    actorUserId: 'super-admin-1',
    actorRole: 'super_admin',
    actorAccountStatus: 'suspended',
    targetStatus: 'CONFIRMED',
  });
  assert.equal(suspendedSuper.allowed, false);
  assert.equal(suspendedSuper.code, 'ACTOR_SUSPENDED');

  const closedAdmin = evaluateTreasuryFundingApproval({
    requestedByUserId: 'ops-admin-1',
    actorUserId: 'finance-admin-2',
    actorRole: 'finance_admin',
    actorAccountStatus: 'closed',
    targetStatus: 'APPROVED',
  });
  assert.equal(closedAdmin.allowed, false);
  assert.equal(closedAdmin.code, 'ACTOR_SUSPENDED');
});

test('Non-treasury approval_requests still strictly forbid self-approval even for Super Admin', () => {
  const manualAdj = evaluateTreasuryFundingApproval({
    requestedByUserId: 'super-admin-1',
    actorUserId: 'super-admin-1',
    actorRole: 'super_admin',
    actorAccountStatus: 'active',
    targetStatus: 'APPROVED',
    requestType: 'manual_balance_adjustment',
  });
  assert.equal(manualAdj.allowed, false);
  assert.equal(manualAdj.code, 'SELF_APPROVAL_FORBIDDEN_FOR_REQUEST_TYPE');

  const transitionCheck = validateApprovalRequestTransition({
    previous: {
      ...BASE_APPROVAL_REQUEST,
      requestedBy: 'super-admin-1',
      status: 'PENDING_SECOND_APPROVAL',
      approvedBy: null,
      rejectedBy: null,
      executedBy: null,
      cancelledBy: null,
      decisionNote: null,
    },
    next: {
      ...BASE_APPROVAL_REQUEST,
      requestedBy: 'super-admin-1',
      status: 'APPROVED',
      approvedBy: 'super-admin-1',
      rejectedBy: null,
      executedBy: null,
      cancelledBy: null,
      decisionNote: null,
    },
    actorUserId: 'super-admin-1',
    actorRole: 'super_admin',
    actorAccountStatus: 'active',
  });
  assert.equal(transitionCheck.allowed, false);
  assert.equal(transitionCheck.code, 'SELF_APPROVAL_FORBIDDEN_FOR_REQUEST_TYPE');
});

test('H-7: blocks immutable field tampering, invalid state transitions, terminal reversals, and missing rejection attribution', () => {
  // Immutable amount tampering on treasury funding
  const amountTamper = validateTreasuryFundingTransition({
    previous: {
      ...BASE_TREASURY_RECORD,
      status: 'PENDING_APPROVAL',
      approvedBy: null,
      rejectedBy: null,
      confirmedBy: null,
      decisionNote: null,
    },
    next: {
      ...BASE_TREASURY_RECORD,
      amount: '99999999',
      status: 'APPROVED',
      approvedBy: 'finance-admin-1',
      rejectedBy: null,
      confirmedBy: null,
      decisionNote: null,
    },
    actorUserId: 'finance-admin-1',
    actorRole: 'finance_admin',
    actorAccountStatus: 'active',
  });
  assert.equal(amountTamper.allowed, false);
  assert.equal(amountTamper.code, 'IMMUTABLE_FIELD_MODIFIED');

  // Skipping APPROVED directly to CONFIRMED
  const skipStep = validateTreasuryFundingTransition({
    previous: {
      ...BASE_TREASURY_RECORD,
      status: 'PENDING_APPROVAL',
      approvedBy: null,
      rejectedBy: null,
      confirmedBy: null,
      decisionNote: null,
    },
    next: {
      ...BASE_TREASURY_RECORD,
      status: 'CONFIRMED',
      approvedBy: 'finance-admin-1',
      rejectedBy: null,
      confirmedBy: 'finance-admin-1',
      decisionNote: null,
    },
    actorUserId: 'finance-admin-1',
    actorRole: 'finance_admin',
    actorAccountStatus: 'active',
  });
  assert.equal(skipStep.allowed, false);
  assert.equal(skipStep.code, 'INVALID_TRANSITION');

  // Reversing from terminal REJECTED state
  const terminalReverse = validateApprovalRequestTransition({
    previous: {
      ...BASE_APPROVAL_REQUEST,
      status: 'REJECTED',
      approvedBy: null,
      rejectedBy: 'compliance-admin-1',
      executedBy: null,
      cancelledBy: null,
      decisionNote: 'Missing invoice',
    },
    next: {
      ...BASE_APPROVAL_REQUEST,
      status: 'APPROVED',
      approvedBy: 'super-admin-1',
      rejectedBy: null,
      executedBy: null,
      cancelledBy: null,
      decisionNote: null,
    },
    actorUserId: 'super-admin-1',
    actorRole: 'super_admin',
    actorAccountStatus: 'active',
  });
  assert.equal(terminalReverse.allowed, false);
  assert.equal(terminalReverse.code, 'TERMINAL_STATUS_LOCKED');

  // Payload mutation on approval_requests
  const payloadTamper = validateApprovalRequestTransition({
    previous: {
      ...BASE_APPROVAL_REQUEST,
      status: 'PENDING_SECOND_APPROVAL',
      approvedBy: null,
      rejectedBy: null,
      executedBy: null,
      cancelledBy: null,
      decisionNote: null,
    },
    next: {
      ...BASE_APPROVAL_REQUEST,
      payload: { asset: 'BTC', delta: '500' },
      status: 'APPROVED',
      approvedBy: 'super-admin-1',
      rejectedBy: null,
      executedBy: null,
      cancelledBy: null,
      decisionNote: null,
    },
    actorUserId: 'super-admin-1',
    actorRole: 'super_admin',
    actorAccountStatus: 'active',
  });
  assert.equal(payloadTamper.allowed, false);
  assert.equal(payloadTamper.code, 'IMMUTABLE_FIELD_MODIFIED');

  // Rejection requires non-empty decisionNote and uses rejectedBy (not approvedBy)
  const missingRejectNote = validateApprovalRequestTransition({
    previous: {
      ...BASE_APPROVAL_REQUEST,
      status: 'PENDING_SECOND_APPROVAL',
      approvedBy: null,
      rejectedBy: null,
      executedBy: null,
      cancelledBy: null,
      decisionNote: null,
    },
    next: {
      ...BASE_APPROVAL_REQUEST,
      status: 'REJECTED',
      approvedBy: null,
      rejectedBy: 'compliance-admin-1',
      executedBy: null,
      cancelledBy: null,
      decisionNote: '   ',
    },
    actorUserId: 'compliance-admin-1',
    actorRole: 'compliance_admin',
    actorAccountStatus: 'active',
  });
  assert.equal(missingRejectNote.allowed, false);
  assert.equal(missingRejectNote.code, 'DECISION_NOTE_REQUIRED');

  const validRejection = validateApprovalRequestTransition({
    previous: {
      ...BASE_APPROVAL_REQUEST,
      status: 'PENDING_SECOND_APPROVAL',
      approvedBy: null,
      rejectedBy: null,
      executedBy: null,
      cancelledBy: null,
      decisionNote: null,
    },
    next: {
      ...BASE_APPROVAL_REQUEST,
      status: 'REJECTED',
      approvedBy: null,
      rejectedBy: 'compliance-admin-1',
      executedBy: null,
      cancelledBy: null,
      decisionNote: 'Insufficient supporting documentation.',
    },
    actorUserId: 'compliance-admin-1',
    actorRole: 'compliance_admin',
    actorAccountStatus: 'active',
  });
  assert.equal(validRejection.allowed, true);
  assert.equal(validRejection.code, 'ALLOWED');
});

test('Phase 1: REJECTED requires decisionNote even when undefined, blocks post-approval decision_note tampering, and enforces actor attribution', () => {
  const undefinedRejectNote = evaluateTreasuryFundingApproval({
    requestedByUserId: 'ops-admin-1',
    actorUserId: 'finance-admin-2',
    actorRole: 'finance_admin',
    actorAccountStatus: 'active',
    targetStatus: 'REJECTED',
  });
  assert.equal(undefinedRejectNote.allowed, false);
  assert.equal(undefinedRejectNote.code, 'DECISION_NOTE_REQUIRED');

  const tamperedDecisionNoteOnConfirm = validateTreasuryFundingTransition({
    previous: {
      ...BASE_TREASURY_RECORD,
      requestedBy: 'ops-admin-1',
      status: 'APPROVED',
      approvedBy: 'finance-admin-2',
      rejectedBy: null,
      confirmedBy: null,
      decisionNote: 'Approved against bank wire ref #101',
    },
    next: {
      ...BASE_TREASURY_RECORD,
      requestedBy: 'ops-admin-1',
      status: 'CONFIRMED',
      approvedBy: 'finance-admin-2',
      rejectedBy: null,
      confirmedBy: 'super-admin-1',
      decisionNote: 'Tampered rationale after approval',
    },
    actorUserId: 'super-admin-1',
    actorRole: 'super_admin',
    actorAccountStatus: 'active',
  });
  assert.equal(tamperedDecisionNoteOnConfirm.allowed, false);
  assert.equal(tamperedDecisionNoteOnConfirm.code, 'IMMUTABLE_FIELD_MODIFIED');

  const spoofedApprover = validateTreasuryFundingTransition({
    previous: {
      ...BASE_TREASURY_RECORD,
      requestedBy: 'ops-admin-1',
      status: 'PENDING_APPROVAL',
      approvedBy: null,
      rejectedBy: null,
      confirmedBy: null,
      decisionNote: null,
    },
    next: {
      ...BASE_TREASURY_RECORD,
      requestedBy: 'ops-admin-1',
      status: 'APPROVED',
      approvedBy: 'other-admin-99',
      rejectedBy: null,
      confirmedBy: null,
      decisionNote: null,
    },
    actorUserId: 'finance-admin-2',
    actorRole: 'finance_admin',
    actorAccountStatus: 'active',
  });
  assert.equal(spoofedApprover.allowed, false);
  assert.equal(spoofedApprover.code, 'ATTRIBUTION_CONFLICT');

  const tamperedDecisionNoteOnExecute = validateApprovalRequestTransition({
    previous: {
      ...BASE_APPROVAL_REQUEST,
      status: 'APPROVED',
      approvedBy: 'super-admin-1',
      rejectedBy: null,
      executedBy: null,
      cancelledBy: null,
      decisionNote: 'Verified audit ticket #44',
    },
    next: {
      ...BASE_APPROVAL_REQUEST,
      status: 'EXECUTED',
      approvedBy: 'super-admin-1',
      rejectedBy: null,
      executedBy: 'ops-admin-2',
      cancelledBy: null,
      decisionNote: 'Altered note on execution',
    },
    actorUserId: 'ops-admin-2',
    actorRole: 'operations_admin',
    actorAccountStatus: 'active',
  });
  assert.equal(tamperedDecisionNoteOnExecute.allowed, false);
  assert.equal(tamperedDecisionNoteOnExecute.code, 'IMMUTABLE_FIELD_MODIFIED');
});

test('L-6: omitting previous.decisionNote fails closed with MISSING_PRIOR_STATE on treasury and approval transitions', () => {
  const omittedTreasuryPrevious = validateTreasuryFundingTransition({
    previous: {
      ...BASE_TREASURY_RECORD,
      requestedBy: 'ops-admin-1',
      status: 'APPROVED',
      approvedBy: 'finance-admin-2',
      rejectedBy: null,
      confirmedBy: null,
    } as unknown as Parameters<typeof validateTreasuryFundingTransition>[0]['previous'],
    next: {
      ...BASE_TREASURY_RECORD,
      requestedBy: 'ops-admin-1',
      status: 'CONFIRMED',
      approvedBy: 'finance-admin-2',
      rejectedBy: null,
      confirmedBy: 'super-admin-1',
      decisionNote: 'Injected rationale during confirmation',
    },
    actorUserId: 'super-admin-1',
    actorRole: 'super_admin',
    actorAccountStatus: 'active',
  });
  assert.equal(omittedTreasuryPrevious.allowed, false);
  assert.equal(omittedTreasuryPrevious.code, 'MISSING_PRIOR_STATE');

  const omittedApprovalPrevious = validateApprovalRequestTransition({
    previous: {
      ...BASE_APPROVAL_REQUEST,
      status: 'APPROVED',
      approvedBy: 'super-admin-1',
      rejectedBy: null,
      executedBy: null,
      cancelledBy: null,
    } as unknown as Parameters<typeof validateApprovalRequestTransition>[0]['previous'],
    next: {
      ...BASE_APPROVAL_REQUEST,
      status: 'EXECUTED',
      approvedBy: 'super-admin-1',
      rejectedBy: null,
      executedBy: 'ops-admin-2',
      cancelledBy: null,
      decisionNote: 'Injected rationale during execution',
    },
    actorUserId: 'ops-admin-2',
    actorRole: 'operations_admin',
    actorAccountStatus: 'active',
  });
  assert.equal(omittedApprovalPrevious.allowed, false);
  assert.equal(omittedApprovalPrevious.code, 'MISSING_PRIOR_STATE');

  const nullToNonNullBlocked = validateApprovalRequestTransition({
    previous: {
      ...BASE_APPROVAL_REQUEST,
      status: 'APPROVED',
      approvedBy: 'super-admin-1',
      rejectedBy: null,
      executedBy: null,
      cancelledBy: null,
      decisionNote: null,
    },
    next: {
      ...BASE_APPROVAL_REQUEST,
      status: 'EXECUTED',
      approvedBy: 'super-admin-1',
      rejectedBy: null,
      executedBy: 'ops-admin-2',
      cancelledBy: null,
      decisionNote: 'Retroactive note',
    },
    actorUserId: 'ops-admin-2',
    actorRole: 'operations_admin',
    actorAccountStatus: 'active',
  });
  assert.equal(nullToNonNullBlocked.allowed, false);
  assert.equal(nullToNonNullBlocked.code, 'IMMUTABLE_FIELD_MODIFIED');
});

test('Phase 1.2 CD-3 [UNIT TEST]: closed admin is rejected for APPROVE, EXECUTE, REJECT, and CANCEL transitions in validateApprovalRequestTransition', () => {
  const closedApprove = validateApprovalRequestTransition({
    previous: {
      ...BASE_APPROVAL_REQUEST,
      status: 'PENDING_SECOND_APPROVAL',
      approvedBy: null,
      rejectedBy: null,
      executedBy: null,
      cancelledBy: null,
      decisionNote: null,
    },
    next: {
      ...BASE_APPROVAL_REQUEST,
      status: 'APPROVED',
      approvedBy: 'ops-admin-closed',
      rejectedBy: null,
      executedBy: null,
      cancelledBy: null,
      decisionNote: null,
    },
    actorUserId: 'ops-admin-closed',
    actorRole: 'operations_admin',
    actorAccountStatus: 'closed',
  });
  assert.equal(closedApprove.allowed, false);
  assert.equal(closedApprove.code, 'ACTOR_SUSPENDED');

  const closedExecute = validateApprovalRequestTransition({
    previous: {
      ...BASE_APPROVAL_REQUEST,
      status: 'APPROVED',
      approvedBy: 'finance-admin-active',
      rejectedBy: null,
      executedBy: null,
      cancelledBy: null,
      decisionNote: 'Approved',
    },
    next: {
      ...BASE_APPROVAL_REQUEST,
      status: 'EXECUTED',
      approvedBy: 'finance-admin-active',
      rejectedBy: null,
      executedBy: 'super-admin-closed',
      cancelledBy: null,
      decisionNote: 'Approved',
    },
    actorUserId: 'super-admin-closed',
    actorRole: 'super_admin',
    actorAccountStatus: 'closed',
  });
  assert.equal(closedExecute.allowed, false);
  assert.equal(closedExecute.code, 'ACTOR_SUSPENDED');

  const closedReject = validateApprovalRequestTransition({
    previous: {
      ...BASE_APPROVAL_REQUEST,
      status: 'PENDING_SECOND_APPROVAL',
      approvedBy: null,
      rejectedBy: null,
      executedBy: null,
      cancelledBy: null,
      decisionNote: null,
    },
    next: {
      ...BASE_APPROVAL_REQUEST,
      status: 'REJECTED',
      approvedBy: null,
      rejectedBy: 'compliance-admin-closed',
      executedBy: null,
      cancelledBy: null,
      decisionNote: 'Closed admin attempt',
    },
    actorUserId: 'compliance-admin-closed',
    actorRole: 'compliance_admin',
    actorAccountStatus: 'closed',
  });
  assert.equal(closedReject.allowed, false);
  assert.equal(closedReject.code, 'ACTOR_SUSPENDED');

  const closedCancel = validateApprovalRequestTransition({
    previous: {
      ...BASE_APPROVAL_REQUEST,
      requestedBy: 'finance-admin-closed',
      status: 'PENDING_SECOND_APPROVAL',
      approvedBy: null,
      rejectedBy: null,
      executedBy: null,
      cancelledBy: null,
      decisionNote: null,
    },
    next: {
      ...BASE_APPROVAL_REQUEST,
      requestedBy: 'finance-admin-closed',
      status: 'CANCELLED',
      approvedBy: null,
      rejectedBy: null,
      executedBy: null,
      cancelledBy: 'finance-admin-closed',
      decisionNote: null,
    },
    actorUserId: 'finance-admin-closed',
    actorRole: 'finance_admin',
    actorAccountStatus: 'closed',
  });
  assert.equal(closedCancel.allowed, false);
  assert.equal(closedCancel.code, 'ACTOR_SUSPENDED');
});

