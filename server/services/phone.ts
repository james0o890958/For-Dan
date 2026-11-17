export type PhoneNormalizationResult =
  | { ok: true; value: string | null }
  | { ok: false; code: 'INVALID_PHONE_NUMBER'; message: string };

const E164_PHONE_REGEX = /^\+[1-9][0-9]{6,14}$/;

/**
 * Normalizes an optional phone number into strict E.164 format (+[country][subscriber]).
 * Missing, null, or whitespace-only values normalize to null (never '').
 */
export function normalizePhoneNumber(raw: unknown): PhoneNormalizationResult {
  if (raw === undefined || raw === null) {
    return { ok: true, value: null };
  }

  if (typeof raw !== 'string') {
    return {
      ok: false,
      code: 'INVALID_PHONE_NUMBER',
      message: 'Phone number must be provided as a string in international E.164 format (e.g. +15550102030).',
    };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }

  const cleaned = trimmed.replace(/[\s().-]+/g, '');
  if (!E164_PHONE_REGEX.test(cleaned)) {
    return {
      ok: false,
      code: 'INVALID_PHONE_NUMBER',
      message:
        'Invalid phone number format. Provide an international E.164 number such as +15550102030, or leave it blank.',
    };
  }

  return { ok: true, value: cleaned };
}

export type ParsedLoginIdentifier =
  | { kind: 'email'; email: string }
  | { kind: 'public_user_id'; publicUserId: string }
  | { kind: 'phone'; phone: string }
  | { kind: 'invalid' };

/**
 * Classifies a login/recovery identifier unambiguously into email, public_user_id,
 * or normalized E.164 phone so lookups never conflate NULL/empty phones with IDs.
 */
export function parseLoginIdentifier(raw: unknown): ParsedLoginIdentifier {
  if (typeof raw !== 'string') {
    return { kind: 'invalid' };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return { kind: 'invalid' };
  }

  if (trimmed.includes('@')) {
    return { kind: 'email', email: trimmed.toLowerCase() };
  }

  if (/^\d{6,20}$/.test(trimmed)) {
    return { kind: 'public_user_id', publicUserId: trimmed };
  }

  if (trimmed.startsWith('+')) {
    const normalized = normalizePhoneNumber(trimmed);
    if (normalized.ok && normalized.value) {
      return { kind: 'phone', phone: normalized.value };
    }
  }

  return { kind: 'invalid' };
}
