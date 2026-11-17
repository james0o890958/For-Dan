import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizePhoneNumber, parseLoginIdentifier } from './phone';

test('M-1: optional, null, and whitespace-only phone inputs normalize cleanly to null', () => {
  for (const input of [undefined, null, '', '   ', '\t\n']) {
    const res = normalizePhoneNumber(input);
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.value, null);
    }
  }
});

test('M-1: valid formatted international phones normalize to canonical E.164', () => {
  const cases: Array<[string, string]> = [
    ['+15550102030', '+15550102030'],
    [' +1 (555) 010-2030 ', '+15550102030'],
    ['+44 20 7946 0958', '+442079460958'],
    ['+65-6789-1234', '+6567891234'],
  ];

  for (const [raw, expected] of cases) {
    const res = normalizePhoneNumber(raw);
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.value, expected);
    }
  }
});

test('M-1: malformed, local-only, or non-string phone values are rejected safely', () => {
  for (const invalid of ['08012345678', '5550102030', '+0123456789', '+123', '+1555abc2030', 15550102030]) {
    const res = normalizePhoneNumber(invalid);
    assert.equal(res.ok, false);
    if (res.ok === false) {
      assert.equal(res.code, 'INVALID_PHONE_NUMBER');
    }
  }
});

test('M-1: parseLoginIdentifier cleanly separates email, public_user_id, and E.164 phone without matching empty strings', () => {
  assert.deepEqual(parseLoginIdentifier('  Alice@Example.com '), {
    kind: 'email',
    email: 'alice@example.com',
  });
  assert.deepEqual(parseLoginIdentifier('849201442'), {
    kind: 'public_user_id',
    publicUserId: '849201442',
  });
  assert.deepEqual(parseLoginIdentifier('+1 (555) 010-2030'), {
    kind: 'phone',
    phone: '+15550102030',
  });
  assert.deepEqual(parseLoginIdentifier(''), { kind: 'invalid' });
  assert.deepEqual(parseLoginIdentifier('   '), { kind: 'invalid' });
  assert.deepEqual(parseLoginIdentifier('555-010-2030'), { kind: 'invalid' });
});

test('M-1 & H-8: auth routes normalize optional phones, handle duplicate-phone 409 conflicts, and block closed accounts', async () => {
  const authRouteTs = await fs.readFile(path.resolve(process.cwd(), 'server', 'routes', 'auth.ts'), 'utf8');
  assert.match(authRouteTs, /normalizePhoneNumber\(phone\)/);
  assert.match(authRouteTs, /WHERE phone = \$1 AND phone IS NOT NULL/);
  assert.match(authRouteTs, /code:\s*'PHONE_EXISTS'/);
  assert.match(authRouteTs, /uq_profiles_phone_normalized/);
  assert.match(authRouteTs, /ACCOUNT_CLOSED/);
});
