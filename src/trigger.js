/**
 * Secure trigger validation for Notion buttons.
 * Token = hex(HMAC-SHA256(action + ':' + date, BUTTON_SECRET))
 */

/**
 * Validates a trigger token.
 * @param {string} action - Action name (regenerate, undo, planning).
 * @param {string} dateStr - Date (YYYY-MM-DD).
 * @param {string} token - Hex-encoded token from query.
 * @param {string} secret - BUTTON_SECRET from env.
 * @returns {Promise<boolean>}
 */
export async function validateTriggerToken(action, dateStr, token, secret) {
  if (!secret || !token) return false;
  const payload = `${action}:${dateStr}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload)
  );
  const expected = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return token.toLowerCase() === expected.toLowerCase();
}

/**
 * Generates a valid trigger token (for scripts/docs).
 * @param {string} action - Action name.
 * @param {string} dateStr - Date (YYYY-MM-DD).
 * @param {string} secret - BUTTON_SECRET.
 * @returns {Promise<string>} Hex token.
 */
export async function generateTriggerToken(action, dateStr, secret) {
  const payload = `${action}:${dateStr}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload)
  );
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
