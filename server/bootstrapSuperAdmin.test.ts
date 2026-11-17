import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOTSTRAP_AUDIT_ACTION,
  evaluateBootstrapEligibility,
  INITIAL_SUPER_ADMIN_EMAIL,
  type BootstrapEligibilityInput,
} from './bootstrapSuperAdmin';

function makeValidInput(overrides: Partial<BootstrapEligibilityInput> = {}): BootstrapEligibilityInput {
  return {
    authUserId: '11111111-2222-3333-4444-555555555555',
    authEmail: 'Coin.base.official01@gmail.com',
    emailConfirmedAt: '2026-11-16T12:00:00.000Z',
    profileExists: true,
    profileEmail: 'coin.base.official01@gmail.com',
    profilePublicUserId: '849201442',
    profileAccountStatus: 'active',
    existingSuperAdminCount: 0,
    bootstrapAuditCount: 0,
    ...overrides,
  };
}

test('accepts only the designated verified Supabase Auth user when no prior bootstrap occurred', () => {
  assert.equal(INITIAL_SUPER_ADMIN_EMAIL, 'coin.base.official01@gmail.com');
  assert.equal(BOOTSTRAP_AUDIT_ACTION, 'INITIAL_SUPER_ADMIN_BOOTSTRAP');

  const result = evaluateBootstrapEligibility(makeValidInput());
  assert.equal(result.eligible, true);
  assert.equal(result.code, 'ELIGIBLE');
});

test('rejects promotion if a super_admin already exists', () => {
  const result = evaluateBootstrapEligibility(makeValidInput({ existingSuperAdminCount: 1 }));
  assert.equal(result.eligible, false);
  assert.equal(result.code, 'BOOTSTRAP_ALREADY_CONSUMED');
});

test('rejects promotion if the immutable audit log shows bootstrap was previously used', () => {
  const result = evaluateBootstrapEligibility(
    makeValidInput({ existingSuperAdminCount: 0, bootstrapAuditCount: 1 })
  );
  assert.equal(result.eligible, false);
  assert.equal(result.code, 'BOOTSTRAP_ALREADY_CONSUMED');
});

test('rejects promotion for any email other than Coin.base.official01@gmail.com', () => {
  const result = evaluateBootstrapEligibility(
    makeValidInput({ authEmail: 'attacker@gmail.com', profileEmail: 'attacker@gmail.com' })
  );
  assert.equal(result.eligible, false);
  assert.equal(result.code, 'EMAIL_MISMATCH');
});

test('rejects promotion if the user has not registered through Supabase Auth yet', () => {
  const result = evaluateBootstrapEligibility(makeValidInput({ authUserId: null }));
  assert.equal(result.eligible, false);
  assert.equal(result.code, 'AUTH_USER_NOT_FOUND');
});

test('rejects promotion when Supabase Auth email is unverified', () => {
  const result = evaluateBootstrapEligibility(makeValidInput({ emailConfirmedAt: null }));
  assert.equal(result.eligible, false);
  assert.equal(result.code, 'EMAIL_NOT_VERIFIED');
});

test('rejects promotion if public.profiles is missing or email does not match', () => {
  const missing = evaluateBootstrapEligibility(makeValidInput({ profileExists: false }));
  assert.equal(missing.eligible, false);
  assert.equal(missing.code, 'PROFILE_NOT_READY');

  const mismatched = evaluateBootstrapEligibility(
    makeValidInput({ profileEmail: 'other@gmail.com' })
  );
  assert.equal(mismatched.eligible, false);
  assert.equal(mismatched.code, 'PROFILE_NOT_READY');
});

test('rejects promotion if account is suspended or closed', () => {
  const suspended = evaluateBootstrapEligibility(makeValidInput({ profileAccountStatus: 'suspended' }));
  assert.equal(suspended.eligible, false);
  assert.equal(suspended.code, 'ACCOUNT_SUSPENDED');

  const closed = evaluateBootstrapEligibility(makeValidInput({ profileAccountStatus: 'closed' }));
  assert.equal(closed.eligible, false);
  assert.equal(closed.code, 'ACCOUNT_CLOSED');
});
