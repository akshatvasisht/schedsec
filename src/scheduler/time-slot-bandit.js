/**
 * Multi-armed bandit for learning optimal time slots per task type.
 * Uses epsilon-greedy selection with Upper Confidence Bound tie-breaking.
 */
export class TimeSlotBandit {
  /**
   * @param {object|null} data Serialized bandit state from `toJSON()`, or null to start fresh.
   */
  constructor(data = null) {
    this.slots = data?.slots || {
      morning: { rewards: 0, tries: 0 },
      midday: { rewards: 0, tries: 0 },
      afternoon: { rewards: 0, tries: 0 },
      evening: { rewards: 0, tries: 0 }
    };
    this.epsilon = data?.epsilon || 0.1;
  }

  /**
   * Selects the best slot using epsilon-greedy with UCB.
   * @returns {string} Slot name (`morning`, `midday`, `afternoon`, or `evening`).
   */
  selectSlot() {
    if (Math.random() < this.epsilon) {
      const keys = Object.keys(this.slots);
      return keys[Math.floor(Math.random() * keys.length)];
    }

    let bestSlot = null;
    let bestScore = -Infinity;
    const totalTries = this.getTotalTries();

    for (const [slot, stats] of Object.entries(this.slots)) {
      const avgReward = stats.tries > 0 ? stats.rewards / stats.tries : 0;
      const exploration = stats.tries > 0
        ? Math.sqrt(2 * Math.log(totalTries + 1) / stats.tries)
        : Infinity;
      const score = avgReward + exploration;

      if (score > bestScore) {
        bestScore = score;
        bestSlot = slot;
      }
    }

    return bestSlot || 'morning';
  }

  /**
   * Records a reward (completion rating 1-5) for a given slot.
   * @param {string} slot Slot name to update (`morning`, `midday`, `afternoon`, or `evening`).
   * @param {number} reward Completion rating (1–5) to add to the slot's cumulative reward.
   */
  updateReward(slot, reward) {
    if (!this.slots[slot]) return;
    this.slots[slot].rewards += reward;
    this.slots[slot].tries += 1;
  }

  /**
   * Returns the total number of tries across all slots.
   * @returns {number} Sum of `tries` for all four time slots.
   */
  getTotalTries() {
    return Object.values(this.slots).reduce((sum, s) => sum + s.tries, 0);
  }

  /**
   * Returns human-readable stats for each slot.
   * @returns {object} Map of slot name to `{ avg_rating: string, attempts: number }`.
   */
  getStats() {
    const stats = {};
    for (const [slot, data] of Object.entries(this.slots)) {
      stats[slot] = {
        avg_rating: data.tries > 0 ? (data.rewards / data.tries).toFixed(2) : 'N/A',
        attempts: data.tries
      };
    }
    return stats;
  }

  /**
   * Serializes state for storage in Context DB.
   * @returns {{ slots: object, epsilon: number }} Plain object suitable for JSON storage.
   */
  toJSON() {
    return { slots: this.slots, epsilon: this.epsilon };
  }
}

/**
 * Manages per-task-type bandits and persists to ContextManager.
 */
export class BanditManager {
  static CONTEXT_KEY = 'time_slot_bandits';

  /**
   * Loads all bandits from context, returning a map of taskType -> TimeSlotBandit.
   * @param {object} context ContextManager instance used to read persisted bandit data.
   * @returns {Promise<object>} Map of task type string to its corresponding TimeSlotBandit instance.
   */
  static async loadAll(context) {
    const raw = await context.get(BanditManager.CONTEXT_KEY) || {};
    const bandits = {};
    for (const [taskType, data] of Object.entries(raw)) {
      bandits[taskType] = new TimeSlotBandit(data);
    }
    return bandits;
  }

  /**
   * Saves all bandits back to context.
   * @param {object} bandits Map of task type string to TimeSlotBandit instance.
   * @param {object} context ContextManager instance used to persist the serialized bandits.
   */
  static async saveAll(bandits, context) {
    const serialized = {};
    for (const [taskType, bandit] of Object.entries(bandits)) {
      serialized[taskType] = bandit.toJSON();
    }
    await context.set(BanditManager.CONTEXT_KEY, serialized, 'Time slot bandit update');
  }

  /**
   * Gets or creates a bandit for a specific task type.
   * @param {object} bandits Mutable map of task type string to TimeSlotBandit instance.
   * @param {string} taskType Task type key (e.g. `'TASK'`, `'TIME_BLOCK'`).
   * @returns {TimeSlotBandit} Existing bandit for the task type, or a newly created one.
   */
  static getOrCreate(bandits, taskType) {
    if (!bandits[taskType]) {
      bandits[taskType] = new TimeSlotBandit();
    }
    return bandits[taskType];
  }
}
