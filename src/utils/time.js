/**
 * Time utility functions for schedule calculations.
 */

/**
 * Converts HH:MM string to minutes since midnight.
 * @param {string} timeStr "HH:MM"
 * @returns {number} The time in minutes past midnight.
 */
export function timeToMinutes(timeStr) {
  if (!timeStr || !timeStr.includes(':')) return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return (hours * 60) + (minutes || 0);
}

/**
 * Converts minutes since midnight to HH:MM string.
 * @param {number} totalMinutes The time in minutes past midnight.
 * @returns {string} The formatted HH:MM time string.
 */
export function minutesToTime(totalMinutes) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Adds minutes to a HH:MM time string.
 * @param timeStr The parameter.
 * @param minsToAdd The parameter.
 * @returns {any} The return value.
 */
export function addMinutes(timeStr, minsToAdd) {
  return minutesToTime(timeToMinutes(timeStr) + minsToAdd);
}

/**
 * Checks if two time ranges overlap.
 * @param start1 The parameter.
 * @param duration1 The parameter.
 * @param start2 The parameter.
 * @param duration2 The parameter.
 * @returns {any} The return value.
 */
export function rangesOverlap(start1, duration1, start2, duration2) {
  const s1 = timeToMinutes(start1);
  const e1 = s1 + duration1;
  const s2 = timeToMinutes(start2);
  const e2 = s2 + duration2;
  return s1 < e2 && s2 < e1;
}


/**
 * Calculates minutes between two HH:MM strings.
 * @param startStr The parameter.
 * @param endStr The parameter.
 * @returns {any} The return value.
 */
export function diffMinutes(startStr, endStr) {
  return timeToMinutes(endStr) - timeToMinutes(startStr);
}

/**
 * Gets day of week name from date string.
 * @param dateStr The parameter.
 * @returns {any} The return value.
 */
export function getDayName(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}
