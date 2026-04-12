/**
 * Normalize a phone number input to E.164 format.
 * Default country: +34 (Spain) when no country prefix is provided.
 * Accepts any valid E.164 number (international).
 * Returns null if the number cannot be normalized to a valid E.164 string.
 */
export function normalizePhone(input: string): string | null {
  // Strip whitespace and common separators
  const cleaned = input.trim().replace(/[\s\-\.\(\)\/]/g, '');

  let e164: string;

  if (cleaned.startsWith('+')) {
    e164 = cleaned;
  } else if (cleaned.startsWith('0034')) {
    e164 = '+34' + cleaned.slice(4);
  } else if (cleaned.startsWith('34') && cleaned.length === 11) {
    // 34 + 9 Spanish digits (no leading +)
    e164 = '+' + cleaned;
  } else {
    // Assume Spanish — prepend +34
    e164 = '+34' + cleaned;
  }

  // E.164: + followed by 7–15 digits
  if (!/^\+[0-9]{7,15}$/.test(e164)) return null;
  return e164;
}

/**
 * Check if a phone number with an existing + prefix is a Spanish (+34) number.
 */
export function isSpanishPhone(e164: string): boolean {
  return e164.startsWith('+34');
}
