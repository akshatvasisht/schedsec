/**
 * Secure trigger validation for Notion buttons.
 * Token = hex(HMAC-SHA256(action + ':' + date, BUTTON_SECRET))
 */

/**
 * Converts a hex string to a Uint8Array.
 * @param {string} hex - Hex-encoded string.
 * @returns {Uint8Array} Byte array.
 */
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Validates a trigger token.
 * @param {string} action - Action name (regenerate, undo, planning).
 * @param {string} dateStr - Date (YYYY-MM-DD).
 * @param {string} token - Hex-encoded token from query.
 * @param {string} secret - BUTTON_SECRET from env.
 * @returns {Promise<boolean>} True when the token matches the current or previous hour bucket.
 */
export async function validateTriggerToken(action, dateStr, token, secret) {
  if (!secret || !token) return false;
  const currentHourBucket = Math.floor(Date.now() / (3600 * 1000));
  const buckets = [currentHourBucket, currentHourBucket - 1];

  for (const hourBucket of buckets) {
    const payload = `${action}:${dateStr}:${hourBucket}`;
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

    // Constant-time comparison to prevent timing attacks
    const tokenBytes = hexToBytes(token.toLowerCase());
    const expectedBytes = hexToBytes(expected.toLowerCase());
    if (tokenBytes.length !== expectedBytes.length) return false;
    let diff = 0;
    for (let i = 0; i < tokenBytes.length; i++) {
      diff |= tokenBytes[i] ^ expectedBytes[i];
    }
    if (diff === 0) return true;
  }

  return false;
}

/**
 * Generates a valid trigger token (for scripts/docs).
 * @param {string} action - Action name.
 * @param {string} dateStr - Date (YYYY-MM-DD).
 * @param {string} secret - BUTTON_SECRET.
 * @returns {Promise<string>} Hex token.
 */
export async function generateTriggerToken(action, dateStr, secret) {
  const hourBucket = Math.floor(Date.now() / (3600 * 1000));
  const payload = `${action}:${dateStr}:${hourBucket}`;
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
