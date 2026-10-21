// Normalises user-typed phone numbers to E.164. Bare 8-digit numbers are treated as Singapore.
export function toE164(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (trimmed.startsWith("+")) return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
  if (/^[3689]\d{7}$/.test(digits)) return `+65${digits}`;
  if (/^65[3689]\d{7}$/.test(digits)) return `+${digits}`;
  return null;
}
