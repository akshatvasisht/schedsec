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
 * @param {string} timeStr Starting time in "HH:MM" format.
 * @param {number} minsToAdd Number of minutes to add, may be negative or exceed 60.
 * @returns {string} Resulting time in "HH:MM" format, wrapping at midnight.
 */
export function addMinutes(timeStr, minsToAdd) {
  return minutesToTime(timeToMinutes(timeStr) + minsToAdd);
}

/**
 * Checks if two time ranges overlap.
 * @param {string} start1 Start time of the first range in "HH:MM" format.
 * @param {number} duration1 Duration of the first range in minutes.
 * @param {string} start2 Start time of the second range in "HH:MM" format.
 * @param {number} duration2 Duration of the second range in minutes.
 * @returns {boolean} True if the two ranges share any overlapping time.
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
 * @param {string} startStr Earlier time in "HH:MM" format.
 * @param {string} endStr Later time in "HH:MM" format.
 * @returns {number} Signed difference in minutes; negative if endStr is before startStr.
 */
export function diffMinutes(startStr, endStr) {
  return timeToMinutes(endStr) - timeToMinutes(startStr);
}

