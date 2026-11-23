/**
 * [MOCKED / IN-MEMORY BEHAVIORAL SIMULATION — NOT REAL POSTGRESQL EXECUTION]
 *
 * This suite models the PL/pgSQL trigger, row-lock (FOR UPDATE vs FOR KEY SHARE),
 * EvalPlanQual (EPQ) re-fetch, and alphabetical trigger-firing behavior defined in
 * migrations 007 and 008 (Phase 1.2: CD-1, CD-2, CD-3).
 *
 * IMPORTANT: Passing these tests verifies the TypeScript state-machine and lock-ordering
 * model in memory only. Isolated live PostgreSQL concurrency verification remains
 * required separately and is NOT executed by this file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

type AccountStatus = 'active' | 'suspended' | 'closed';
type AppRole = 'customer' | 'super_admin' | 'operations_admin' | 'finance_admin' | 'compliance_admin';
type ApprovalStatus = 'PENDING_SECOND_APPROVAL' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'CANCELLED';

interface ProfileRow {
  id: string;
  public_user_id: string;
  email: string;
  full_name: string;
  phone: string | null;
  account_status: AccountStatus;
  closed_at: string | null;
  anonymized_at: string | null;
}

interface WalletBalanceRow {
  id: string;
  user_id: string;
  asset_symbol: string;
  available: number;
  reserved: number;
}

interface DepositAddressRow {
  id: string;
  user_id: string;
  asset_symbol: string;
  network_code: string;
  custody_vault_id: string;
  address: string;
  memo_or_tag: string | null;
  is_active: boolean;
  created_at: string;
}

interface DepositRow {
  id: string;
  user_id: string;
  status: 'PENDING_DETECTION' | 'CREDITED' | 'REJECTED';
}

interface WithdrawalRow {
  id: string;
  user_id: string;
  status: 'REQUESTED' | 'COMPLETED' | 'REJECTED' | 'CANCELLED' | 'REFUNDED';
}

interface SpotOrderRow {
  id: string;
  user_id: string;
  status: 'SUBMITTED' | 'PARTIALLY_FILLED' | 'FILLED' | 'REJECTED' | 'CANCELLED';
}

interface ApprovalRequestRow {
  id: string;
  request_type: 'manual_balance_adjustment' | 'treasury_funding' | 'inventory_adjustment' | 'pricing_override';
  target_table: string;
  target_id: string | null;
  payload: Record<string, unknown>;
  reason_code: string;
  summary: string;
  status: ApprovalStatus;
  requested_by: string;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  executed_by: string | null;
  executed_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  decision_note: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

interface TxSession {
  txId: string;
  profileLocks: Map<string, 'FOR KEY SHARE' | 'FOR UPDATE'>;
  advisoryLocks: Set<string>;
  uncommittedProfiles: Map<string, ProfileRow>;
}

const ADMIN_ROLES = new Set<AppRole>([
  'super_admin',
  'operations_admin',
  'finance_admin',
  'compliance_admin',
]);

class SimulatedExchangeDb {
  profiles = new Map<string, ProfileRow>();
  userRoles = new Map<string, Set<AppRole>>();
  walletBalances = new Map<string, WalletBalanceRow>();
  depositAddresses = new Map<string, DepositAddressRow>();
  deposits = new Map<string, DepositRow>();
  withdrawals = new Map<string, WithdrawalRow>();
  spotOrders = new Map<string, SpotOrderRow>();
  approvalRequests = new Map<string, ApprovalRequestRow>();
  lockAcquisitionLog: Array<{ txId: string; profileId: string; mode: 'FOR KEY SHARE' | 'FOR UPDATE' }> = [];

  private activeSessions = new Set<TxSession>();

  seedProfile(profile: ProfileRow, role: AppRole = 'customer') {
    this.profiles.set(profile.id, { ...profile });
    this.userRoles.set(profile.id, new Set([role]));
  }

  begin(txId: string): TxSession {
    const session: TxSession = {
      txId,
      profileLocks: new Map(),
      advisoryLocks: new Set(),
      uncommittedProfiles: new Map(),
    };
    this.activeSessions.add(session);
    return session;
  }

  commit(session: TxSession) {
    for (const [id, row] of session.uncommittedProfiles.entries()) {
      this.profiles.set(id, { ...row });
    }
    session.uncommittedProfiles.clear();
    session.profileLocks.clear();
    session.advisoryLocks.clear();
    this.activeSessions.delete(session);
  }

  rollback(session: TxSession) {
    session.uncommittedProfiles.clear();
    session.profileLocks.clear();
    session.advisoryLocks.clear();
    this.activeSessions.delete(session);
  }

  private hasAdvisoryLockConflict(session: TxSession, userId: string): boolean {
    for (const other of this.activeSessions) {
      if (other !== session && other.advisoryLocks.has(userId)) {
        return true;
      }
    }
    return false;
  }

  private hasProfileLockConflict(
    session: TxSession,
    profileId: string,
    mode: 'FOR KEY SHARE' | 'FOR UPDATE'
  ): boolean {
    for (const other of this.activeSessions) {
      if (other === session) continue;
      const otherMode = other.profileLocks.get(profileId);
      if (!otherMode) continue;
      if (mode === 'FOR UPDATE' || otherMode === 'FOR UPDATE') {
        return true;
      }
    }
    return false;
  }

  acquireAdvisoryLock(session: TxSession, userId: string) {
    if (this.hasAdvisoryLockConflict(session, userId)) {
      throw new Error(`LOCK_WOULD_BLOCK: advisory lock held for ${userId}`);
    }
    session.advisoryLocks.add(userId);
  }

  // Models PostgreSQL READ COMMITTED LockRows + EPQ committed read
  lockProfile(session: TxSession, profileId: string, mode: 'FOR KEY SHARE' | 'FOR UPDATE'): ProfileRow | null {
    const committed = session.uncommittedProfiles.get(profileId) ?? this.profiles.get(profileId);
    if (!committed) return null;

    if (this.hasProfileLockConflict(session, profileId, mode)) {
      throw new Error(`LOCK_WOULD_BLOCK: profiles(${profileId}) ${mode} conflicts with active session`);
    }

    const existing = session.profileLocks.get(profileId);
    if (existing !== 'FOR UPDATE') {
      session.profileLocks.set(profileId, mode);
    }
    this.lockAcquisitionLog.push({ txId: session.txId, profileId, mode });
    // Read latest committed state (or own uncommitted update) after lock acquisition (EPQ semantics)
    return { ...(session.uncommittedProfiles.get(profileId) ?? this.profiles.get(profileId)!) };
  }

  private getEffectiveProfile(session: TxSession, profileId: string): ProfileRow | undefined {
    return session.uncommittedProfiles.get(profileId) ?? this.profiles.get(profileId);
  }

  // Models public.guard_closed_account_obligation_write() from migration 008
  private runGuardClosedAccountObligationWrite(
    session: TxSession,
    tableName: 'wallet_balances' | 'deposits' | 'withdrawals' | 'spot_orders' | 'deposit_addresses',
    op: 'INSERT' | 'UPDATE',
    oldRow: Record<string, unknown> | null,
    newRow: Record<string, unknown>
  ) {
    // CD-2: Immutable user_id check
    if (op === 'UPDATE' && oldRow && newRow.user_id !== oldRow.user_id) {
      throw new Error(
        `Ownership (user_id) of ${tableName} record (${String(oldRow.id)}) cannot be reassigned after creation.`
      );
    }

    // CD-1: Always acquire FOR KEY SHARE before checking closed-account rules
    const newUserId = String(newRow.user_id);
    const profile = this.lockProfile(session, newUserId, 'FOR KEY SHARE');
    if (!profile) {
      throw new Error(`Account profile (${newUserId}) does not exist for ${tableName} operation.`);
    }

    if (profile.account_status === 'closed') {
      if (tableName === 'wallet_balances') {
        if (op === 'INSERT' && Number(newRow.available) === 0 && Number(newRow.reserved) === 0) {
          return;
        }
        throw new Error(`Cannot create or modify wallet_balances for closed account (${newUserId}).`);
      }

      if (tableName === 'deposit_addresses') {
        const oldAddr = oldRow as DepositAddressRow | null;
        const newAddr = newRow as unknown as DepositAddressRow;
        if (
          op === 'UPDATE' &&
          oldAddr !== null &&
          oldAddr.is_active === true &&
          newAddr.is_active === false &&
          newAddr.id === oldAddr.id &&
          newAddr.user_id === oldAddr.user_id &&
          newAddr.asset_symbol === oldAddr.asset_symbol &&
          newAddr.network_code === oldAddr.network_code &&
          newAddr.custody_vault_id === oldAddr.custody_vault_id &&
          newAddr.address === oldAddr.address &&
          (newAddr.memo_or_tag ?? null) === (oldAddr.memo_or_tag ?? null) &&
          newAddr.created_at === oldAddr.created_at
        ) {
          return;
        }
        throw new Error(`Cannot create or modify deposit_addresses for closed account (${newUserId}).`);
      }

      throw new Error(`Cannot create or modify ${tableName} financial obligation for closed account (${newUserId}).`);
    }
  }

  mutateWalletBalance(session: TxSession, op: 'INSERT' | 'UPDATE', row: WalletBalanceRow) {
    const oldRow = op === 'UPDATE' ? this.walletBalances.get(row.id) ?? null : null;
    if (op === 'UPDATE' && !oldRow) throw new Error('Row not found');
    this.runGuardClosedAccountObligationWrite(
      session,
      'wallet_balances',
      op,
      oldRow as unknown as Record<string, unknown> | null,
      row as unknown as Record<string, unknown>
    );
    this.walletBalances.set(row.id, { ...row });
  }

  mutateDeposit(session: TxSession, op: 'INSERT' | 'UPDATE', row: DepositRow) {
    const oldRow = op === 'UPDATE' ? this.deposits.get(row.id) ?? null : null;
    if (op === 'UPDATE' && !oldRow) throw new Error('Row not found');
    this.runGuardClosedAccountObligationWrite(
      session,
      'deposits',
      op,
      oldRow as unknown as Record<string, unknown> | null,
      row as unknown as Record<string, unknown>
    );
    this.deposits.set(row.id, { ...row });
  }

  mutateWithdrawal(session: TxSession, op: 'INSERT' | 'UPDATE', row: WithdrawalRow) {
    const oldRow = op === 'UPDATE' ? this.withdrawals.get(row.id) ?? null : null;
    if (op === 'UPDATE' && !oldRow) throw new Error('Row not found');
    this.runGuardClosedAccountObligationWrite(
      session,
      'withdrawals',
      op,
      oldRow as unknown as Record<string, unknown> | null,
      row as unknown as Record<string, unknown>
    );
    this.withdrawals.set(row.id, { ...row });
  }

  mutateSpotOrder(session: TxSession, op: 'INSERT' | 'UPDATE', row: SpotOrderRow) {
    const oldRow = op === 'UPDATE' ? this.spotOrders.get(row.id) ?? null : null;
    if (op === 'UPDATE' && !oldRow) throw new Error('Row not found');
    this.runGuardClosedAccountObligationWrite(
      session,
      'spot_orders',
      op,
      oldRow as unknown as Record<string, unknown> | null,
      row as unknown as Record<string, unknown>
    );
    this.spotOrders.set(row.id, { ...row });
  }

  mutateDepositAddress(session: TxSession, op: 'INSERT' | 'UPDATE', row: DepositAddressRow) {
    const oldRow = op === 'UPDATE' ? this.depositAddresses.get(row.id) ?? null : null;
    if (op === 'UPDATE' && !oldRow) throw new Error('Row not found');
    this.runGuardClosedAccountObligationWrite(
      session,
      'deposit_addresses',
      op,
      oldRow as unknown as Record<string, unknown> | null,
      row as unknown as Record<string, unknown>
    );
    this.depositAddresses.set(row.id, { ...row });
  }

  private findInvolvedProfileIdsForApprovalRequest(
    row: ApprovalRequestRow,
    actorId: string | null
  ): string[] {
    const matched: string[] = [];
    for (const p of this.profiles.values()) {
      const wbMatch =
        row.target_table === 'wallet_balances' &&
        row.target_id !== null &&
        Array.from(this.walletBalances.values()).some((wb) => wb.id === row.target_id && wb.user_id === p.id);

      const isMatch =
        p.id === row.requested_by ||
        (actorId !== null && p.id === actorId) ||
        (row.target_id !== null && p.id === row.target_id) ||
        (row.target_id !== null && p.public_user_id === row.target_id) ||
        (typeof row.payload.userId === 'string' && p.id === row.payload.userId) ||
        (typeof row.payload.user_id === 'string' && p.id === row.payload.user_id) ||
        (typeof row.payload.publicUserId === 'string' && p.public_user_id === row.payload.publicUserId) ||
        (typeof row.payload.public_user_id === 'string' && p.public_user_id === row.payload.public_user_id) ||
        wbMatch;

      if (isMatch) {
        matched.push(p.id);
      }
    }
    // ORDER BY p.id ASC (PostgreSQL UUID byte/string ascending order matches canonical hyphenated lowercase UUID sort)
    return matched.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  private lockProfilesAscending(session: TxSession, ids: string[]): ProfileRow[] {
    const locked: ProfileRow[] = [];
    for (const id of ids) {
      const row = this.lockProfile(session, id, 'FOR KEY SHARE');
      if (row) locked.push(row);
    }
    return locked;
  }

  // Trigger 1 (alphabetically first): trg_enforce_approval_request_rules
  private runEnforceApprovalRequestRules(
    session: TxSession,
    op: 'INSERT' | 'UPDATE',
    oldRow: ApprovalRequestRow | null,
    newRow: ApprovalRequestRow
  ): ApprovalRequestRow {
    const next = { ...newRow, payload: { ...newRow.payload } };
    const nowIso = new Date().toISOString();

    if (op === 'INSERT') {
      if (next.status !== 'PENDING_SECOND_APPROVAL') {
        throw new Error(`New approval request (${next.request_type}) must start in PENDING_SECOND_APPROVAL status.`);
      }
      if (
        next.approved_by !== null ||
        next.approved_at !== null ||
        next.rejected_by !== null ||
        next.rejected_at !== null ||
        next.executed_by !== null ||
        next.executed_at !== null ||
        next.cancelled_by !== null ||
        next.cancelled_at !== null ||
        next.decision_note !== null
      ) {
        throw new Error('New approval request cannot include pre-populated decision or execution fields.');
      }

      const ids = this.findInvolvedProfileIdsForApprovalRequest(next, null);
      const locked = this.lockProfilesAscending(session, ids);
      const requester = locked.find((p) => p.id === next.requested_by);
      const roles = this.userRoles.get(next.requested_by);
      const isAdmin =
        requester?.account_status === 'active' &&
        Boolean(roles && Array.from(roles).some((r) => ADMIN_ROLES.has(r)));
      if (!isAdmin) {
        throw new Error(`Approval request requester (${next.requested_by}) must be an active authorized administrator.`);
      }
      return next;
    }

    if (!oldRow) throw new Error('Missing OLD row on UPDATE');

    if (
      next.id !== oldRow.id ||
      next.request_type !== oldRow.request_type ||
      next.target_table !== oldRow.target_table ||
      next.target_id !== oldRow.target_id ||
      JSON.stringify(next.payload) !== JSON.stringify(oldRow.payload) ||
      next.reason_code !== oldRow.reason_code ||
      next.summary !== oldRow.summary ||
      next.requested_by !== oldRow.requested_by ||
      next.idempotency_key !== oldRow.idempotency_key ||
      next.created_at !== oldRow.created_at
    ) {
      throw new Error(`Immutable approval request fields (${oldRow.id}) cannot be modified after creation.`);
    }

    if (oldRow.status === 'REJECTED' || oldRow.status === 'EXECUTED' || oldRow.status === 'CANCELLED') {
      throw new Error(`Approval request in terminal status ${oldRow.status} cannot be modified.`);
    }

    if (next.status === oldRow.status) {
      if (
        next.approved_by !== oldRow.approved_by ||
        next.approved_at !== oldRow.approved_at ||
        next.rejected_by !== oldRow.rejected_by ||
        next.rejected_at !== oldRow.rejected_at ||
        next.executed_by !== oldRow.executed_by ||
        next.executed_at !== oldRow.executed_at ||
        next.cancelled_by !== oldRow.cancelled_by ||
        next.cancelled_at !== oldRow.cancelled_at ||
        next.decision_note !== oldRow.decision_note
      ) {
        throw new Error('Approval request decision attribution cannot be modified without a valid state transition.');
      }
      next.updated_at = nowIso;
      return next;
    }

    let actorId: string | null = null;
    if (oldRow.status === 'PENDING_SECOND_APPROVAL' && next.status === 'APPROVED') {
      if (
        !next.approved_by ||
        next.rejected_by !== null ||
        next.rejected_at !== null ||
        next.executed_by !== null ||
        next.executed_at !== null ||
        next.cancelled_by !== null ||
        next.cancelled_at !== null
      ) {
        throw new Error('PENDING_SECOND_APPROVAL -> APPROVED attribution/timestamp error.');
      }
      actorId = next.approved_by;
      next.approved_at = next.approved_at ?? nowIso;
    } else if (oldRow.status === 'PENDING_SECOND_APPROVAL' && next.status === 'REJECTED') {
      if (!next.rejected_by || !(next.decision_note ?? '').trim()) {
        throw new Error('PENDING_SECOND_APPROVAL -> REJECTED requires rejected_by and a non-empty decision_note.');
      }
      if (
        next.approved_by !== null ||
        next.approved_at !== null ||
        next.executed_by !== null ||
        next.executed_at !== null ||
        next.cancelled_by !== null ||
        next.cancelled_at !== null
      ) {
        throw new Error('Rejected approval request cannot record approved/executed/cancelled timestamps or actors.');
      }
      actorId = next.rejected_by;
      next.rejected_at = next.rejected_at ?? nowIso;
    } else if (oldRow.status === 'PENDING_SECOND_APPROVAL' && next.status === 'CANCELLED') {
      if (
        !next.cancelled_by ||
        next.approved_by !== null ||
        next.approved_at !== null ||
        next.rejected_by !== null ||
        next.rejected_at !== null ||
        next.executed_by !== null ||
        next.executed_at !== null
      ) {
        throw new Error('PENDING_SECOND_APPROVAL -> CANCELLED attribution/timestamp error.');
      }
      actorId = next.cancelled_by;
      next.cancelled_at = next.cancelled_at ?? nowIso;
    } else if (oldRow.status === 'APPROVED' && next.status === 'EXECUTED') {
      if (
        next.approved_by !== oldRow.approved_by ||
        next.approved_at !== oldRow.approved_at ||
        next.decision_note !== oldRow.decision_note ||
        next.rejected_by !== null ||
        next.rejected_at !== null ||
        next.cancelled_by !== null ||
        next.cancelled_at !== null
      ) {
        throw new Error('Original approval attribution, timestamps, and decision_note cannot be altered during execution.');
      }
      if (!next.executed_by) {
        throw new Error('APPROVED -> EXECUTED requires executed_by.');
      }
      actorId = next.executed_by;
      next.executed_at = next.executed_at ?? nowIso;
    } else {
      throw new Error(`Invalid approval request status transition: ${oldRow.status} -> ${next.status}.`);
    }

    const ids = this.findInvolvedProfileIdsForApprovalRequest(next, actorId);
    const locked = this.lockProfilesAscending(session, ids);
    const actorProfile = locked.find((p) => p.id === actorId);
    if (!actorProfile || actorProfile.account_status !== 'active') {
      throw new Error(`Approval request actor (${actorId}) must be an active authorized administrator.`);
    }

    const roles = this.userRoles.get(actorId);
    const actorIsAdmin = Boolean(roles && Array.from(roles).some((r) => ADMIN_ROLES.has(r)));
    const actorIsSuperAdmin = Boolean(roles?.has('super_admin'));
    if (!actorIsAdmin) {
      throw new Error(`Approval request actor (${actorId}) must be an active authorized administrator.`);
    }

    if (next.status === 'CANCELLED') {
      if (actorId !== next.requested_by && !actorIsSuperAdmin) {
        throw new Error('Only the requesting admin or an active Super Admin may cancel a pending approval request.');
      }
    } else if (actorId === next.requested_by) {
      if (next.request_type !== 'treasury_funding' || !actorIsSuperAdmin) {
        throw new Error('Maker-checker violation.');
      }
    }

    next.updated_at = nowIso;
    return next;
  }

  // Trigger 2 (alphabetically second): trg_guard_closed_account_approval_requests
  private runGuardClosedAccountApprovalRequestWrite(
    session: TxSession,
    op: 'INSERT' | 'UPDATE',
    oldRow: ApprovalRequestRow | null,
    newRow: ApprovalRequestRow
  ) {
    const actorId =
      op === 'INSERT'
        ? newRow.requested_by
        : oldRow && newRow.status !== oldRow.status
          ? newRow.status === 'APPROVED'
            ? newRow.approved_by
            : newRow.status === 'REJECTED'
              ? newRow.rejected_by
              : newRow.status === 'EXECUTED'
                ? newRow.executed_by
                : newRow.status === 'CANCELLED'
                  ? newRow.cancelled_by
                  : null
          : null;

    const ids = this.findInvolvedProfileIdsForApprovalRequest(newRow, actorId);
    const locked = this.lockProfilesAscending(session, ids);
    for (const p of locked) {
      if (actorId !== null && p.id === actorId && p.account_status !== 'active') {
        throw new Error(
          `Approval request actor (${actorId}) has non-active account status (${p.account_status}) and cannot perform ${op} on approval_requests (${newRow.id}).`
        );
      }
      if (
        p.account_status === 'closed' &&
        (op === 'INSERT' ||
          newRow.status === 'PENDING_SECOND_APPROVAL' ||
          newRow.status === 'APPROVED' ||
          newRow.status === 'EXECUTED')
      ) {
        throw new Error(`Cannot create or advance approval_requests (${newRow.id}) for closed account (${p.id}).`);
      }
    }
  }

  private assertApprovalRequestCheckConstraint(row: ApprovalRequestRow) {
    const s = row.status;
    const valid =
      (s === 'PENDING_SECOND_APPROVAL' &&
        !row.approved_by && !row.approved_at &&
        !row.rejected_by && !row.rejected_at &&
        !row.executed_by && !row.executed_at &&
        !row.cancelled_by && !row.cancelled_at) ||
      (s === 'APPROVED' &&
        Boolean(row.approved_by && row.approved_at) &&
        !row.rejected_by && !row.rejected_at &&
        !row.executed_by && !row.executed_at &&
        !row.cancelled_by && !row.cancelled_at) ||
      (s === 'REJECTED' &&
        Boolean(row.rejected_by && row.rejected_at) &&
        !row.approved_by && !row.approved_at &&
        !row.executed_by && !row.executed_at &&
        !row.cancelled_by && !row.cancelled_at) ||
      (s === 'EXECUTED' &&
        Boolean(row.approved_by && row.approved_at && row.executed_by && row.executed_at) &&
        !row.rejected_by && !row.rejected_at &&
        !row.cancelled_by && !row.cancelled_at) ||
      (s === 'CANCELLED' &&
        Boolean(row.cancelled_by && row.cancelled_at) &&
        !row.approved_by && !row.approved_at &&
        !row.rejected_by && !row.rejected_at &&
        !row.executed_by && !row.executed_at);
    if (!valid) {
      throw new Error('CHECK constraint chk_approval_requests_state_attribution violated.');
    }
  }

  mutateApprovalRequest(session: TxSession, op: 'INSERT' | 'UPDATE', row: ApprovalRequestRow): ApprovalRequestRow {
    const oldRow = op === 'UPDATE' ? this.approvalRequests.get(row.id) ?? null : null;
    if (op === 'UPDATE' && !oldRow) throw new Error('approval_requests row not found');

    // Alphabetical BEFORE trigger firing: enforce first, then guard
    const afterEnforce = this.runEnforceApprovalRequestRules(session, op, oldRow, row);
    this.runGuardClosedAccountApprovalRequestWrite(session, op, oldRow, afterEnforce);
    this.assertApprovalRequestCheckConstraint(afterEnforce);
    this.approvalRequests.set(afterEnforce.id, afterEnforce);
    return afterEnforce;
  }

  // Models public.close_customer_account(p_user_id, p_anonymize_pii)
  closeCustomerAccount(session: TxSession, userId: string, anonymizePii = false) {
    this.acquireAdvisoryLock(session, userId);
    const profile = this.lockProfile(session, userId, 'FOR UPDATE');
    if (!profile) {
      throw new Error(`Account profile (${userId}) does not exist.`);
    }

    for (const wb of this.walletBalances.values()) {
      if (wb.user_id === userId && (wb.available > 0 || wb.reserved > 0)) {
        throw new Error(`Cannot close account (${userId}): non-zero available or reserved wallet balances remain.`);
      }
    }

    for (const ord of this.spotOrders.values()) {
      if (ord.user_id === userId && (ord.status === 'SUBMITTED' || ord.status === 'PARTIALLY_FILLED')) {
        throw new Error(`Cannot close account (${userId}): open spot orders remain.`);
      }
    }

    for (const w of this.withdrawals.values()) {
      if (w.user_id === userId && !['COMPLETED', 'REJECTED', 'CANCELLED', 'REFUNDED'].includes(w.status)) {
        throw new Error(`Cannot close account (${userId}): in-flight withdrawal requests remain.`);
      }
    }

    for (const d of this.deposits.values()) {
      if (d.user_id === userId && !['CREDITED', 'REJECTED'].includes(d.status)) {
        throw new Error(`Cannot close account (${userId}): unresolved deposit records remain.`);
      }
    }

    for (const ar of this.approvalRequests.values()) {
      if (ar.status !== 'PENDING_SECOND_APPROVAL' && ar.status !== 'APPROVED') continue;
      const referencesWb =
        ar.target_table === 'wallet_balances' &&
        ar.target_id !== null &&
        Array.from(this.walletBalances.values()).some((wb) => wb.id === ar.target_id && wb.user_id === userId);
      const matches =
        ar.requested_by === userId ||
        ar.target_id === userId ||
        ar.target_id === profile.public_user_id ||
        ar.payload.userId === userId ||
        ar.payload.user_id === userId ||
        ar.payload.publicUserId === profile.public_user_id ||
        ar.payload.public_user_id === profile.public_user_id ||
        referencesWb;
      if (matches) {
        throw new Error(`Cannot close account (${userId}): unresolved approval requests remain.`);
      }
    }

    for (const da of Array.from(this.depositAddresses.values())) {
      if (da.user_id === userId && da.is_active) {
        this.mutateDepositAddress(session, 'UPDATE', { ...da, is_active: false });
      }
    }

    const now = new Date().toISOString();
    const updated: ProfileRow = {
      ...profile,
      account_status: 'closed',
      closed_at: profile.closed_at ?? now,
      full_name: anonymizePii ? 'Closed Account' : profile.full_name,
      email: anonymizePii ? `closed+${profile.public_user_id}@anonymized.local` : profile.email,
      phone: anonymizePii ? null : profile.phone,
      anonymized_at: anonymizePii ? profile.anonymized_at ?? now : profile.anonymized_at,
    };
    session.uncommittedProfiles.set(userId, updated);
    this.getEffectiveProfile(session, userId);
  }
}

const UUID_ADMIN_1 = '00000000-0000-0000-0000-000000000001';
const UUID_ADMIN_2 = '00000000-0000-0000-0000-000000000002';
const UUID_ADMIN_3 = '00000000-0000-0000-0000-000000000003';
const UUID_CUST_1 = '00000000-0000-0000-0000-000000000010';
const UUID_CUST_2 = '00000000-0000-0000-0000-000000000020';

function createFixtureDb(): SimulatedExchangeDb {
  const db = new SimulatedExchangeDb();
  db.seedProfile(
    {
      id: UUID_ADMIN_1,
      public_user_id: '100000001',
      email: 'admin1@exchange.local',
      full_name: 'Admin One',
      phone: null,
      account_status: 'active',
      closed_at: null,
      anonymized_at: null,
    },
    'finance_admin'
  );
  db.seedProfile(
    {
      id: UUID_ADMIN_2,
      public_user_id: '100000002',
      email: 'admin2@exchange.local',
      full_name: 'Admin Two',
      phone: null,
      account_status: 'active',
      closed_at: null,
      anonymized_at: null,
    },
    'operations_admin'
  );
  db.seedProfile(
    {
      id: UUID_ADMIN_3,
      public_user_id: '100000003',
      email: 'admin3@exchange.local',
      full_name: 'Admin Three',
      phone: null,
      account_status: 'active',
      closed_at: null,
      anonymized_at: null,
    },
    'super_admin'
  );
  db.seedProfile(
    {
      id: UUID_CUST_1,
      public_user_id: '200000001',
      email: 'cust1@exchange.local',
      full_name: 'Customer One',
      phone: '+15550100001',
      account_status: 'active',
      closed_at: null,
      anonymized_at: null,
    },
    'customer'
  );
  db.seedProfile(
    {
      id: UUID_CUST_2,
      public_user_id: '200000002',
      email: 'cust2@exchange.local',
      full_name: 'Customer Two',
      phone: '+15550100002',
      account_status: 'active',
      closed_at: null,
      anonymized_at: null,
    },
    'customer'
  );
  return db;
}

test('Phase 1.2 CD-1 [SIMULATION — NOT REAL POSTGRESQL]: blocks inactive deposit_addresses mutations, new inactive inserts, and reactivations for closed accounts while permitting legitimate deactivation', () => {
  const db = createFixtureDb();
  const activeAddr: DepositAddressRow = {
    id: 'da-1',
    user_id: UUID_CUST_1,
    asset_symbol: 'USDT',
    network_code: 'TRC-20',
    custody_vault_id: 'vault-1',
    address: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
    memo_or_tag: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
  };
  const txSetup = db.begin('setup');
  db.mutateDepositAddress(txSetup, 'INSERT', activeAddr);
  db.commit(txSetup);

  // Legitimate closure deactivates active address cleanly
  const txClose = db.begin('close-cust1');
  db.closeCustomerAccount(txClose, UUID_CUST_1, true);
  db.commit(txClose);

  const closedRow = db.depositAddresses.get('da-1')!;
  assert.equal(db.profiles.get(UUID_CUST_1)?.account_status, 'closed');
  assert.equal(closedRow.is_active, false);

  // Attempt modifying every protected column on inactive address of closed user
  const mutatableCases: Array<[string, Partial<DepositAddressRow>]> = [
    ['address', { address: 'TModifiedEvilAddress11111111111111' }],
    ['memo_or_tag', { memo_or_tag: '999888' }],
    ['network_code', { network_code: 'ERC-20' }],
    ['asset_symbol', { asset_symbol: 'BTC' }],
    ['custody_vault_id', { custody_vault_id: 'vault-hijacked' }],
    ['created_at', { created_at: '2027-01-01T00:00:00Z' }],
  ];

  for (const [field, patch] of mutatableCases) {
    const tx = db.begin(`mutate-${field}`);
    assert.throws(
      () => db.mutateDepositAddress(tx, 'UPDATE', { ...closedRow, ...patch }),
      /Cannot create or modify deposit_addresses for closed account/
    );
    db.rollback(tx);
  }

  // Attempt creating a new inactive address (is_active = false) for closed account
  const txNewInactive = db.begin('insert-inactive');
  assert.throws(
    () =>
      db.mutateDepositAddress(txNewInactive, 'INSERT', {
        ...activeAddr,
        id: 'da-2',
        network_code: 'ERC-20',
        is_active: false,
      }),
    /Cannot create or modify deposit_addresses for closed account/
  );
  db.rollback(txNewInactive);

  // Attempt reactivating an inactive address belonging to closed account
  const txReactivate = db.begin('reactivate');
  assert.throws(
    () => db.mutateDepositAddress(txReactivate, 'UPDATE', { ...closedRow, is_active: true }),
    /Cannot create or modify deposit_addresses for closed account/
  );
  db.rollback(txReactivate);

  // Even if an active deposit address still existed on an already-closed account,
  // deactivation with modified address must fail, while pure TRUE -> FALSE deactivation succeeds.
  db.depositAddresses.set('da-active-straggler', {
    ...activeAddr,
    id: 'da-active-straggler',
    network_code: 'BTC',
    is_active: true,
  });
  const txBadDeactivate = db.begin('bad-deactivate');
  assert.throws(
    () =>
      db.mutateDepositAddress(txBadDeactivate, 'UPDATE', {
        ...db.depositAddresses.get('da-active-straggler')!,
        is_active: false,
        address: 'bc1qevil000000000000000000000000',
      }),
    /Cannot create or modify deposit_addresses for closed account/
  );
  db.rollback(txBadDeactivate);

  const txCleanDeactivate = db.begin('clean-deactivate');
  db.mutateDepositAddress(txCleanDeactivate, 'UPDATE', {
    ...db.depositAddresses.get('da-active-straggler')!,
    is_active: false,
  });
  db.commit(txCleanDeactivate);
  assert.equal(db.depositAddresses.get('da-active-straggler')?.is_active, false);
});

test('Phase 1.2 CD-2 [SIMULATION — NOT REAL POSTGRESQL]: rejects user_id ownership reassignment on all five protected tables', () => {
  const db = createFixtureDb();
  const txSeed = db.begin('seed-cd2');
  db.mutateWalletBalance(txSeed, 'INSERT', { id: 'wb-1', user_id: UUID_CUST_1, asset_symbol: 'USDT', available: 0, reserved: 0 });
  db.mutateDeposit(txSeed, 'INSERT', { id: 'dep-1', user_id: UUID_CUST_1, status: 'CREDITED' });
  db.mutateWithdrawal(txSeed, 'INSERT', { id: 'wd-1', user_id: UUID_CUST_1, status: 'COMPLETED' });
  db.mutateSpotOrder(txSeed, 'INSERT', { id: 'ord-1', user_id: UUID_CUST_1, status: 'FILLED' });
  db.mutateDepositAddress(txSeed, 'INSERT', {
    id: 'da-1',
    user_id: UUID_CUST_1,
    asset_symbol: 'USDT',
    network_code: 'TRC-20',
    custody_vault_id: 'v1',
    address: 'TAddr1',
    memo_or_tag: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
  });
  db.commit(txSeed);

  // Close CUST_1 so ownership theft off closed account is also directly modeled
  const txClose = db.begin('close-cust1');
  db.closeCustomerAccount(txClose, UUID_CUST_1, false);
  db.commit(txClose);

  const txReassign = db.begin('reassign');
  assert.throws(
    () =>
      db.mutateWalletBalance(txReassign, 'UPDATE', {
        ...db.walletBalances.get('wb-1')!,
        user_id: UUID_CUST_2,
      }),
    /Ownership \(user_id\) of wallet_balances record \(wb-1\) cannot be reassigned/
  );
  assert.throws(
    () => db.mutateDeposit(txReassign, 'UPDATE', { ...db.deposits.get('dep-1')!, user_id: UUID_CUST_2 }),
    /Ownership \(user_id\) of deposits record \(dep-1\) cannot be reassigned/
  );
  assert.throws(
    () => db.mutateWithdrawal(txReassign, 'UPDATE', { ...db.withdrawals.get('wd-1')!, user_id: UUID_CUST_2 }),
    /Ownership \(user_id\) of withdrawals record \(wd-1\) cannot be reassigned/
  );
  assert.throws(
    () => db.mutateSpotOrder(txReassign, 'UPDATE', { ...db.spotOrders.get('ord-1')!, user_id: UUID_CUST_2 }),
    /Ownership \(user_id\) of spot_orders record \(ord-1\) cannot be reassigned/
  );
  assert.throws(
    () =>
      db.mutateDepositAddress(txReassign, 'UPDATE', {
        ...db.depositAddresses.get('da-1')!,
        user_id: UUID_CUST_2,
      }),
    /Ownership \(user_id\) of deposit_addresses record \(da-1\) cannot be reassigned/
  );
  db.rollback(txReassign);
});

test('Phase 1.2 CD-3 [SIMULATION — NOT REAL POSTGRESQL]: blocks closed admin approval/execution, enforces concurrency serialization with close_customer_account, and locks profiles in ascending UUID order', () => {
  const db = createFixtureDb();
  const baseReq: ApprovalRequestRow = {
    id: 'ar-1',
    request_type: 'manual_balance_adjustment',
    target_table: 'wallet_balances',
    target_id: null,
    payload: { userId: UUID_CUST_1, delta: '10' },
    reason_code: 'AUDIT_FIX',
    summary: 'Adjustment',
    status: 'PENDING_SECOND_APPROVAL',
    requested_by: UUID_ADMIN_1,
    approved_by: null,
    approved_at: null,
    rejected_by: null,
    rejected_at: null,
    executed_by: null,
    executed_at: null,
    cancelled_by: null,
    cancelled_at: null,
    decision_note: null,
    idempotency_key: 'idem-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  // Insert PENDING request by active ADMIN_1 for CUST_1 (notice UUID_ADMIN_1 < UUID_CUST_1)
  const txCreate = db.begin('create-req');
  db.lockAcquisitionLog = [];
  db.mutateApprovalRequest(txCreate, 'INSERT', baseReq);
  db.commit(txCreate);

  // Verify ascending UUID lock order during INSERT
  const insertLocks = db.lockAcquisitionLog
    .filter((entry) => entry.txId === 'create-req')
    .map((entry) => entry.profileId);
  assert.deepEqual(insertLocks, [UUID_ADMIN_1, UUID_CUST_1, UUID_ADMIN_1, UUID_CUST_1]);

  // Interleaving 1: close_customer_account(ADMIN_2) acquires FOR UPDATE first;
  // ADMIN_2 attempting to approve blocks and then fails via EPQ after closure commits.
  const txCloseAdmin2 = db.begin('close-admin2');
  db.closeCustomerAccount(txCloseAdmin2, UUID_ADMIN_2, false);

  const txConcurrentApprove = db.begin('concurrent-approve');
  assert.throws(
    () =>
      db.mutateApprovalRequest(txConcurrentApprove, 'UPDATE', {
        ...db.approvalRequests.get('ar-1')!,
        status: 'APPROVED',
        approved_by: UUID_ADMIN_2,
      }),
    /LOCK_WOULD_BLOCK: profiles\(00000000-0000-0000-0000-000000000002\) FOR KEY SHARE/
  );
  db.rollback(txConcurrentApprove);
  db.commit(txCloseAdmin2);

  // Now ADMIN_2 is closed -> attempting approval MUST fail (closed admin cannot approve)
  const txClosedApprove = db.begin('closed-approve');
  assert.throws(
    () =>
      db.mutateApprovalRequest(txClosedApprove, 'UPDATE', {
        ...db.approvalRequests.get('ar-1')!,
        status: 'APPROVED',
        approved_by: UUID_ADMIN_2,
      }),
    /must be an active authorized administrator/
  );
  db.rollback(txClosedApprove);
  assert.equal(db.approvalRequests.get('ar-1')?.approved_by, null);

  // Interleaving 2: Active ADMIN_3 approves -> acquires FOR KEY SHARE on [ADMIN_1, ADMIN_3, CUST_1] FIRST;
  // Concurrent close_customer_account(ADMIN_3) MUST block until approval commits!
  const txApprove3 = db.begin('approve-admin3');
  db.lockAcquisitionLog = [];
  const approvedRow = db.mutateApprovalRequest(txApprove3, 'UPDATE', {
    ...db.approvalRequests.get('ar-1')!,
    status: 'APPROVED',
    approved_by: UUID_ADMIN_3,
  });

  // Assert deterministic ascending UUID order: ADMIN_1 (01) < ADMIN_3 (03) < CUST_1 (10)
  const approveLocks = db.lockAcquisitionLog
    .filter((entry) => entry.txId === 'approve-admin3')
    .map((entry) => entry.profileId);
  assert.deepEqual(approveLocks, [
    UUID_ADMIN_1,
    UUID_ADMIN_3,
    UUID_CUST_1,
    UUID_ADMIN_1,
    UUID_ADMIN_3,
    UUID_CUST_1,
  ]);

  const txBlockedClosure = db.begin('blocked-closure-admin3');
  assert.throws(
    () => db.closeCustomerAccount(txBlockedClosure, UUID_ADMIN_3, false),
    /LOCK_WOULD_BLOCK: profiles\(00000000-0000-0000-0000-000000000003\) FOR UPDATE/
  );
  db.rollback(txBlockedClosure);
  db.commit(txApprove3);
  assert.equal(approvedRow.status, 'APPROVED');

  // Now close ADMIN_3, and verify closed ADMIN_3 cannot EXECUTE the request
  const txCloseAdmin3 = db.begin('close-admin3');
  db.closeCustomerAccount(txCloseAdmin3, UUID_ADMIN_3, false);
  db.commit(txCloseAdmin3);

  const txClosedExec = db.begin('closed-exec');
  assert.throws(
    () =>
      db.mutateApprovalRequest(txClosedExec, 'UPDATE', {
        ...db.approvalRequests.get('ar-1')!,
        status: 'EXECUTED',
        executed_by: UUID_ADMIN_3,
      }),
    /must be an active authorized administrator/
  );
  db.rollback(txClosedExec);
});

test('Phase 1.2 [SIMULATION — NOT REAL POSTGRESQL] REGRESSION: preserves idempotent closure, balance/deposit/withdrawal/order/approval closure blockers, and timestamp/attribution rules', () => {
  const db = createFixtureDb();

  // 1. Non-zero balance blocks closure
  const txSeed = db.begin('seed-reg');
  db.mutateWalletBalance(txSeed, 'INSERT', {
    id: 'wb-c1',
    user_id: UUID_CUST_1,
    asset_symbol: 'USDT',
    available: 25,
    reserved: 0,
  });
  db.commit(txSeed);

  const txCloseFailBal = db.begin('close-bal');
  assert.throws(() => db.closeCustomerAccount(txCloseFailBal, UUID_CUST_1), /non-zero available or reserved wallet balances/);
  db.rollback(txCloseFailBal);

  const txZeroBal = db.begin('zero-bal');
  db.mutateWalletBalance(txZeroBal, 'UPDATE', { ...db.walletBalances.get('wb-c1')!, available: 0 });
  db.commit(txZeroBal);

  // 2. Unresolved deposit blocks closure
  const txDep = db.begin('add-dep');
  db.mutateDeposit(txDep, 'INSERT', { id: 'dep-c1', user_id: UUID_CUST_1, status: 'PENDING_DETECTION' });
  db.commit(txDep);
  const txCloseFailDep = db.begin('close-dep');
  assert.throws(() => db.closeCustomerAccount(txCloseFailDep, UUID_CUST_1), /unresolved deposit records/);
  db.rollback(txCloseFailDep);
  const txResolveDep = db.begin('res-dep');
  db.mutateDeposit(txResolveDep, 'UPDATE', { id: 'dep-c1', user_id: UUID_CUST_1, status: 'CREDITED' });
  db.commit(txResolveDep);

  // 3. Unresolved withdrawal blocks closure
  const txWd = db.begin('add-wd');
  db.mutateWithdrawal(txWd, 'INSERT', { id: 'wd-c1', user_id: UUID_CUST_1, status: 'REQUESTED' });
  db.commit(txWd);
  const txCloseFailWd = db.begin('close-wd');
  assert.throws(() => db.closeCustomerAccount(txCloseFailWd, UUID_CUST_1), /in-flight withdrawal requests/);
  db.rollback(txCloseFailWd);
  const txResolveWd = db.begin('res-wd');
  db.mutateWithdrawal(txResolveWd, 'UPDATE', { id: 'wd-c1', user_id: UUID_CUST_1, status: 'COMPLETED' });
  db.commit(txResolveWd);

  // 4. Open spot order blocks closure
  const txOrd = db.begin('add-ord');
  db.mutateSpotOrder(txOrd, 'INSERT', { id: 'ord-c1', user_id: UUID_CUST_1, status: 'SUBMITTED' });
  db.commit(txOrd);
  const txCloseFailOrd = db.begin('close-ord');
  assert.throws(() => db.closeCustomerAccount(txCloseFailOrd, UUID_CUST_1), /open spot orders/);
  db.rollback(txCloseFailOrd);
  const txResolveOrd = db.begin('res-ord');
  db.mutateSpotOrder(txResolveOrd, 'UPDATE', { id: 'ord-c1', user_id: UUID_CUST_1, status: 'FILLED' });
  db.commit(txResolveOrd);

  // 5. Pending approval_requests blocks closure until rejected/executed
  const txAr = db.begin('add-ar');
  const createdAr = db.mutateApprovalRequest(txAr, 'INSERT', {
    id: 'ar-c1',
    request_type: 'manual_balance_adjustment',
    target_table: 'wallet_balances',
    target_id: 'wb-c1',
    payload: { delta: '0' },
    reason_code: 'AUDIT',
    summary: 'Check',
    status: 'PENDING_SECOND_APPROVAL',
    requested_by: UUID_ADMIN_1,
    approved_by: null,
    approved_at: null,
    rejected_by: null,
    rejected_at: null,
    executed_by: null,
    executed_at: null,
    cancelled_by: null,
    cancelled_at: null,
    decision_note: null,
    idempotency_key: 'idem-c1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  });
  db.commit(txAr);

  const txCloseFailAr = db.begin('close-ar');
  assert.throws(() => db.closeCustomerAccount(txCloseFailAr, UUID_CUST_1), /unresolved approval requests/);
  db.rollback(txCloseFailAr);

  // Approve -> Execute preserves approved_at & decision_note; terminal EXECUTED immutable
  const txArApprove = db.begin('ar-approve');
  const approvedAr = db.mutateApprovalRequest(txArApprove, 'UPDATE', {
    ...createdAr,
    status: 'APPROVED',
    approved_by: UUID_ADMIN_2,
    decision_note: 'Verified ticket #1',
  });
  db.commit(txArApprove);
  assert.ok(approvedAr.approved_at);

  const txBadExecTs = db.begin('ar-bad-exec');
  assert.throws(
    () =>
      db.mutateApprovalRequest(txBadExecTs, 'UPDATE', {
        ...approvedAr,
        status: 'EXECUTED',
        approved_at: '2020-01-01T00:00:00Z',
        executed_by: UUID_ADMIN_3,
      }),
    /Original approval attribution, timestamps, and decision_note cannot be altered/
  );
  db.rollback(txBadExecTs);

  const txArExec = db.begin('ar-exec');
  const executedAr = db.mutateApprovalRequest(txArExec, 'UPDATE', {
    ...approvedAr,
    status: 'EXECUTED',
    executed_by: UUID_ADMIN_3,
  });
  db.commit(txArExec);
  assert.ok(executedAr.executed_at);
  assert.equal(executedAr.approved_at, approvedAr.approved_at);

  // 6. Active deposit address deactivated cleanly, and closure is idempotent
  const txAddDa = db.begin('add-da');
  db.mutateDepositAddress(txAddDa, 'INSERT', {
    id: 'da-c1',
    user_id: UUID_CUST_1,
    asset_symbol: 'USDT',
    network_code: 'TRC-20',
    custody_vault_id: 'v1',
    address: 'TAddrReg1',
    memo_or_tag: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
  });
  db.commit(txAddDa);

  const txClose1 = db.begin('close-1');
  db.closeCustomerAccount(txClose1, UUID_CUST_1, true);
  db.commit(txClose1);
  const firstClosedAt = db.profiles.get(UUID_CUST_1)?.closed_at;
  assert.ok(firstClosedAt);
  assert.equal(db.depositAddresses.get('da-c1')?.is_active, false);

  const txClose2 = db.begin('close-2');
  db.closeCustomerAccount(txClose2, UUID_CUST_1, false);
  db.commit(txClose2);
  assert.equal(db.profiles.get(UUID_CUST_1)?.closed_at, firstClosedAt);
  assert.equal(db.profiles.get(UUID_CUST_1)?.account_status, 'closed');
});
