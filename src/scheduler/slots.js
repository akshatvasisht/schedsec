import { timeToMinutes, minutesToTime, rangesOverlap } from '../utils/time.js';
import { CONFIG } from '../config.js';

/**
 * Finds available time slots for scheduling tasks.
 */
export class SlotFinder {
  /**
   * Finds the earliest available slot for a task.
   * @param duration The parameter.
   * @param constraints The parameter.
   * @param existingSchedule The parameter.
   * @param workDayStart The parameter.
   * @param workDayEnd The parameter.
   * @returns {any} The return value.
   */
  static findEarliestSlot(duration, constraints, existingSchedule, workDayStart = CONFIG.DEFAULTS.WORK_DAY_START, workDayEnd = CONFIG.DEFAULTS.WORK_DAY_END) {
    const startLimit = timeToMinutes(workDayStart);
    const endLimit = timeToMinutes(workDayEnd);
    const buffer = CONFIG.DEFAULTS.BUFFER_TIME;

    // Collect all unavailable blocks
    const unavailable = existingSchedule.map(s => ({
      start: timeToMinutes(s.start),
      end: timeToMinutes(s.start) + s.duration
    })).sort((a, b) => a.start - b.start);

    // Iterate through day looking for a gap
    let currentStart = startLimit;

    while (currentStart + duration <= endLimit) {
      const currentEnd = currentStart + duration;

      // Check if current slot overlaps with any unavailable block
      const overlap = unavailable.find(block =>
        (currentStart < block.end && currentEnd > block.start)
      );

      if (!overlap) {
        // Potential slot found, now check hard constraints (e.g. must_complete_by)
        if (constraints.mustCompleteBy) {
          const deadline = timeToMinutes(constraints.mustCompleteBy);
          if (currentEnd > deadline) {
            return null; // Violates deadline
          }
        }

        return minutesToTime(currentStart);
      }

      // Move to end of overlapping block plus buffer
      currentStart = overlap.end + buffer;
    }

    return null; // No slot found
  }

  /**
   * Checks if a specific time is available.
   * @param start The parameter.
   * @param duration The parameter.
   * @param existingSchedule The parameter.
   * @returns {any} The return value.
   */
  static isAvailable(start, duration, existingSchedule) {
    return !existingSchedule.some(s =>
      rangesOverlap(start, duration, s.start, s.duration)
    );
  }
}
