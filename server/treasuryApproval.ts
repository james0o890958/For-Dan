import type { AccountStatus, AppRole } from '../src/types/domain';

export type TreasuryApprovalAction = 'APPROVED' | 'CONFIRMED' | 'REJECTED';
export type TreasuryFundingStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'CONFIRMED' | 'REJECTED';
export type ApprovalRequestStatus =
  | 'PENDING_SECOND_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXECUTED'
  | 'CANCELLED';

export type ApprovalRequestType =
  | 'treasury_funding'
  | 'manual_balance_adjustment'
  | 'inventory_adjustment'
  | 'pricing_override';

export interface TreasuryApprovalValidationInput {
  requestedByUserId: string;
  actorUserId: string;
  actorRole: AppRole;
  actorAccountStatus: AccountStatus;
  targetStatus: TreasuryApprovalAction;
  requestType?: ApprovalRequestType;
  decisionNote?: string | null;
}

export interface TreasuryApprovalValidationResult {
  allowed: boolean;
  code:
    | 'ALLOWED'
    | 'ACTOR_SUSPENDED'
    | 'UNAUTHORIZED_ROLE'
    | 'DECISION_NOTE_REQUIRED'
    | 'SELF_APPROVAL_REQUIRES_SUPER_ADMIN'
    | 'SELF_APPROVAL_FORBIDDEN_FOR_REQUEST_TYPE';
  reason: string;
  requiresDualControl: boolean;
}

const ADMIN_ROLES = new Set<AppRole>([
  'super_admin',
  'operations_admin',
  'finance_admin',
  'compliance_admin',
]);

export function evaluateTreasuryFundingApproval(
  input: TreasuryApprovalValidationInput
): TreasuryApprovalValidationResult {
  const requestType = input.requestType ?? 'treasury_funding';

  if (input.actorAccountStatus !== 'active') {
    return {
      allowed: false,
      code: 'ACTOR_SUSPENDED',
      reason: 'Inactive, suspended, or closed administrator accounts cannot approve or confirm requests.',
      requiresDualControl: input.actorRole !== 'super_admin' || requestType !== 'treasury_funding',
    };
  }

  if (!ADMIN_ROLES.has(input.actorRole)) {
    return {
      allowed: false,
      code: 'UNAUTHORIZED_ROLE',
      reason: 'Only active authorized administrators may approve, confirm, or reject requests.',
      requiresDualControl: true,
    };
  }

  if (input.targetStatus === 'REJECTED' && !input.decisionNote?.trim()) {
    return {
      allowed: false,
      code: 'DECISION_NOTE_REQUIRED',
      reason: 'Rejecting a request requires a non-empty decision_note.',
      requiresDualControl: true,
    };
  }

  const isSelfDecision = input.actorUserId === input.requestedByUserId;

  if (requestType !== 'treasury_funding') {
    if (isSelfDecision) {
      return {
        allowed: false,
        code: 'SELF_APPROVAL_FORBIDDEN_FOR_REQUEST_TYPE',
        reason: `Dual-admin maker-checker required for ${requestType}; a different administrator must review this request.`,
        requiresDualControl: true,
      };
    }

    return {
      allowed: true,
      code: 'ALLOWED',
      reason: 'Authorized secondary administrator decision permitted.',
      requiresDualControl: true,
    };
  }

  if (isSelfDecision && input.actorRole !== 'super_admin') {
    return {
      allowed: false,
      code: 'SELF_APPROVAL_REQUIRES_SUPER_ADMIN',
      reason:
        'Non-Super Admin administrators cannot approve, confirm, or reject their own treasury funding requests; a different authorized administrator must approve them.',
      requiresDualControl: true,
    };
  }

  return {
    allowed: true,
    code: 'ALLOWED',
    reason: isSelfDecision
      ? 'Super Admin self-decision permitted for treasury funding.'
      : 'Authorized administrator decision permitted for treasury funding.',
    requiresDualControl: input.actorRole !== 'super_admin',
  };
}

export interface TreasuryFundingImmutableFields {
  id: string;
  treasuryWalletId: string;
  assetSymbol: string;
  networkCode: string;
  direction: string;
  amount: string | number;
  requestedBy: string;
  note: string;
  idempotencyKey: string;
}

export interface TransitionValidationResult {
  allowed: boolean;
  code:
    | 'ALLOWED'
    | 'IMMUTABLE_FIELD_MODIFIED'
    | 'TERMINAL_STATUS_LOCKED'
    | 'INVALID_TRANSITION'
    | 'ATTRIBUTION_CONFLICT'
    | 'DECISION_NOTE_REQUIRED'
    | 'MISSING_PRIOR_STATE'
    | 'ACTOR_SUSPENDED'
    | 'UNAUTHORIZED_ROLE'
    | 'SELF_APPROVAL_REQUIRES_SUPER_ADMIN'
    | 'SELF_APPROVAL_FORBIDDEN_FOR_REQUEST_TYPE'
    | 'CANCELLATION_FORBIDDEN';
  reason: string;
}

function sameImmutableValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function validateTreasuryFundingTransition(params: {
  previous: TreasuryFundingImmutableFields & {
    status: TreasuryFundingStatus;
    approvedBy: string | null;
    rejectedBy: string | null;
    confirmedBy: string | null;
    decisionNote: string | null;
  };
  next: TreasuryFundingImmutableFields & {
    status: TreasuryFundingStatus;
    approvedBy: string | null;
    rejectedBy: string | null;
    confirmedBy: string | null;
    decisionNote: string | null;
  };
  actorUserId: string;
  actorRole: AppRole;
  actorAccountStatus: AccountStatus;
}): TransitionValidationResult {
  const { previous, next } = params;
  if (
    !Object.prototype.hasOwnProperty.call(previous, 'decisionNote') ||
    previous.decisionNote === undefined
  ) {
    return {
      allowed: false,
      code: 'MISSING_PRIOR_STATE',
      reason: 'Prior treasury funding decisionNote must be explicitly provided to validate transitions.',
    };
  }
  const immutablePairs: Array<[unknown, unknown]> = [
    [previous.id, next.id],
    [previous.treasuryWalletId, next.treasuryWalletId],
    [previous.assetSymbol, next.assetSymbol],
    [previous.networkCode, next.networkCode],
    [previous.direction, next.direction],
    [String(previous.amount), String(next.amount)],
    [previous.requestedBy, next.requestedBy],
    [previous.note, next.note],
    [previous.idempotencyKey, next.idempotencyKey],
  ];

  if (immutablePairs.some(([a, b]) => !sameImmutableValue(a, b))) {
    return {
      allowed: false,
      code: 'IMMUTABLE_FIELD_MODIFIED',
      reason: 'Immutable treasury funding request fields cannot be modified after creation.',
    };
  }

  if (previous.status === 'CONFIRMED' || previous.status === 'REJECTED') {
    return {
      allowed: false,
      code: 'TERMINAL_STATUS_LOCKED',
      reason: `Treasury funding request in terminal status ${previous.status} cannot be modified.`,
    };
  }

  const validTransition =
    (previous.status === 'PENDING_APPROVAL' && (next.status === 'APPROVED' || next.status === 'REJECTED')) ||
    (previous.status === 'APPROVED' && next.status === 'CONFIRMED');

  if (!validTransition) {
    return {
      allowed: false,
      code: 'INVALID_TRANSITION',
      reason: `Invalid treasury funding status transition: ${previous.status} -> ${next.status}.`,
    };
  }

  if (next.status === 'APPROVED') {
    if (!next.approvedBy || next.approvedBy !== params.actorUserId || next.confirmedBy || next.rejectedBy) {
      return {
        allowed: false,
        code: 'ATTRIBUTION_CONFLICT',
        reason: 'APPROVED status requires approvedBy matching the acting admin and null confirmedBy/rejectedBy.',
      };
    }
  } else if (next.status === 'REJECTED') {
    if (!next.rejectedBy || next.rejectedBy !== params.actorUserId || next.approvedBy || next.confirmedBy) {
      return {
        allowed: false,
        code: 'ATTRIBUTION_CONFLICT',
        reason: 'REJECTED status requires rejectedBy matching the acting admin and null approvedBy/confirmedBy.',
      };
    }
    if (!next.decisionNote?.trim()) {
      return {
        allowed: false,
        code: 'DECISION_NOTE_REQUIRED',
        reason: 'Rejecting a treasury funding request requires a non-empty decision_note.',
      };
    }
  } else if (next.status === 'CONFIRMED') {
    if (previous.approvedBy !== next.approvedBy || !next.confirmedBy || next.confirmedBy !== params.actorUserId || next.rejectedBy) {
      return {
        allowed: false,
        code: 'ATTRIBUTION_CONFLICT',
        reason: 'CONFIRMED status must preserve approvedBy and record confirmedBy matching the acting admin.',
      };
    }
    if (!sameImmutableValue(previous.decisionNote, next.decisionNote)) {
      return {
        allowed: false,
        code: 'IMMUTABLE_FIELD_MODIFIED',
        reason: 'Original approval decision_note cannot be modified during confirmation.',
      };
    }
  }

  const targetStatus: TreasuryApprovalAction =
    next.status === 'CONFIRMED'
      ? 'CONFIRMED'
      : next.status === 'REJECTED'
        ? 'REJECTED'
        : 'APPROVED';

  const authCheck = evaluateTreasuryFundingApproval({
    requestedByUserId: previous.requestedBy,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    actorAccountStatus: params.actorAccountStatus,
    targetStatus,
    requestType: 'treasury_funding',
    decisionNote: targetStatus === 'REJECTED' ? next.decisionNote : (next.decisionNote ?? 'verified'),
  });

  if (!authCheck.allowed) {
    return {
      allowed: false,
      code: authCheck.code,
      reason: authCheck.reason,
    };
  }

  return {
    allowed: true,
    code: 'ALLOWED',
    reason: authCheck.reason,
  };
}

export interface ApprovalRequestImmutableFields {
  id: string;
  requestType: ApprovalRequestType;
  targetTable: string;
  targetId: string | null;
  payload: unknown;
  reasonCode: string;
  summary: string;
  requestedBy: string;
  idempotencyKey: string;
}

export function validateApprovalRequestTransition(params: {
  previous: ApprovalRequestImmutableFields & {
    status: ApprovalRequestStatus;
    approvedBy: string | null;
    rejectedBy: string | null;
    executedBy: string | null;
    cancelledBy: string | null;
    decisionNote: string | null;
  };
  next: ApprovalRequestImmutableFields & {
    status: ApprovalRequestStatus;
    approvedBy: string | null;
    rejectedBy: string | null;
    executedBy: string | null;
    cancelledBy: string | null;
    decisionNote: string | null;
  };
  actorUserId: string;
  actorRole: AppRole;
  actorAccountStatus: AccountStatus;
}): TransitionValidationResult {
  const { previous, next } = params;
  if (
    !Object.prototype.hasOwnProperty.call(previous, 'decisionNote') ||
    previous.decisionNote === undefined
  ) {
    return {
      allowed: false,
      code: 'MISSING_PRIOR_STATE',
      reason: 'Prior approval request decisionNote must be explicitly provided to validate transitions.',
    };
  }
  const immutablePairs: Array<[unknown, unknown]> = [
    [previous.id, next.id],
    [previous.requestType, next.requestType],
    [previous.targetTable, next.targetTable],
    [previous.targetId, next.targetId],
    [previous.payload, next.payload],
    [previous.reasonCode, next.reasonCode],
    [previous.summary, next.summary],
    [previous.requestedBy, next.requestedBy],
    [previous.idempotencyKey, next.idempotencyKey],
  ];

  if (immutablePairs.some(([a, b]) => !sameImmutableValue(a, b))) {
    return {
      allowed: false,
      code: 'IMMUTABLE_FIELD_MODIFIED',
      reason: 'Immutable approval request fields cannot be modified after creation.',
    };
  }

  if (
    previous.status === 'REJECTED' ||
    previous.status === 'EXECUTED' ||
    previous.status === 'CANCELLED'
  ) {
    return {
      allowed: false,
      code: 'TERMINAL_STATUS_LOCKED',
      reason: `Approval request in terminal status ${previous.status} cannot be modified.`,
    };
  }

  const validTransition =
    (previous.status === 'PENDING_SECOND_APPROVAL' &&
      (next.status === 'APPROVED' || next.status === 'REJECTED' || next.status === 'CANCELLED')) ||
    (previous.status === 'APPROVED' && next.status === 'EXECUTED');

  if (!validTransition) {
    return {
      allowed: false,
      code: 'INVALID_TRANSITION',
      reason: `Invalid approval request status transition: ${previous.status} -> ${next.status}.`,
    };
  }

  if (params.actorAccountStatus !== 'active') {
    return {
      allowed: false,
      code: 'ACTOR_SUSPENDED',
      reason: 'Inactive, suspended, or closed administrators cannot transition approval requests.',
    };
  }

  if (!ADMIN_ROLES.has(params.actorRole)) {
    return {
      allowed: false,
      code: 'UNAUTHORIZED_ROLE',
      reason: 'Only active authorized administrators may transition approval requests.',
    };
  }

  if (next.status === 'CANCELLED') {
    if (
      !next.cancelledBy ||
      next.cancelledBy !== params.actorUserId ||
      next.approvedBy ||
      next.rejectedBy ||
      next.executedBy
    ) {
      return {
        allowed: false,
        code: 'ATTRIBUTION_CONFLICT',
        reason: 'CANCELLED status requires cancelledBy matching the acting admin and null decision/execution fields.',
      };
    }
    if (params.actorUserId !== previous.requestedBy && params.actorRole !== 'super_admin') {
      return {
        allowed: false,
        code: 'CANCELLATION_FORBIDDEN',
        reason: 'Only the requesting admin or an active Super Admin may cancel a pending request.',
      };
    }
    return {
      allowed: true,
      code: 'ALLOWED',
      reason: 'Pending approval request cancelled cleanly.',
    };
  }

  if (next.status === 'REJECTED') {
    if (
      !next.rejectedBy ||
      next.rejectedBy !== params.actorUserId ||
      next.approvedBy ||
      next.executedBy ||
      next.cancelledBy
    ) {
      return {
        allowed: false,
        code: 'ATTRIBUTION_CONFLICT',
        reason: 'REJECTED status requires rejectedBy matching the acting admin and null approvedBy/executedBy/cancelledBy.',
      };
    }
    if (!next.decisionNote?.trim()) {
      return {
        allowed: false,
        code: 'DECISION_NOTE_REQUIRED',
        reason: 'Rejecting an approval request requires a non-empty decision_note.',
      };
    }
  } else if (next.status === 'APPROVED') {
    if (
      !next.approvedBy ||
      next.approvedBy !== params.actorUserId ||
      next.rejectedBy ||
      next.executedBy ||
      next.cancelledBy
    ) {
      return {
        allowed: false,
        code: 'ATTRIBUTION_CONFLICT',
        reason: 'APPROVED status requires approvedBy matching the acting admin and null rejectedBy/executedBy/cancelledBy.',
      };
    }
  } else if (next.status === 'EXECUTED') {
    if (
      previous.approvedBy !== next.approvedBy ||
      !next.executedBy ||
      next.executedBy !== params.actorUserId ||
      next.rejectedBy ||
      next.cancelledBy
    ) {
      return {
        allowed: false,
        code: 'ATTRIBUTION_CONFLICT',
        reason: 'EXECUTED status must preserve approvedBy and record executedBy matching the acting admin.',
      };
    }
    if (!sameImmutableValue(previous.decisionNote, next.decisionNote)) {
      return {
        allowed: false,
        code: 'IMMUTABLE_FIELD_MODIFIED',
        reason: 'Original approval decision_note cannot be altered during execution.',
      };
    }
  }

  const decisionAction: TreasuryApprovalAction =
    next.status === 'REJECTED' ? 'REJECTED' : 'APPROVED';
  const authCheck = evaluateTreasuryFundingApproval({
    requestedByUserId: previous.requestedBy,
    actorUserId: params.actorUserId,
    actorRole: params.actorRole,
    actorAccountStatus: params.actorAccountStatus,
    targetStatus: decisionAction,
    requestType: previous.requestType,
    decisionNote: decisionAction === 'REJECTED' ? next.decisionNote : (next.decisionNote ?? 'verified'),
  });

  if (!authCheck.allowed) {
    return {
      allowed: false,
      code: authCheck.code,
      reason: authCheck.reason,
    };
  }

  return {
    allowed: true,
    code: 'ALLOWED',
    reason: authCheck.reason,
  };
}
