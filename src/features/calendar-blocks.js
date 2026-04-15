
/**
 * External Calendar Block Management
 * Manages immovable external calendar events that block scheduling slots.
 */
export class CalendarBlocks {
  /**
   * Creates a CalendarBlocks manager backed by the given ContextManager.
   * @param {object} context ContextManager instance used to persist and retrieve calendar block data.
   */
  constructor(context) {
    this.context = context;
    this.CONTEXT_KEY = 'external_calendar_blocks';
  }

  /**
   * Fetches all calendar blocks from Context DB.
   * @returns {Array} Array of { date, start, end, label }
   */
  async getBlocks() {
    return await this.context.get(this.CONTEXT_KEY) || [];
  }

  /**
   * Adds a new external calendar block.
   * @param {string} date Date of the blocked event in YYYY-MM-DD format.
   * @param {string} start Block start time in HH:MM format.
   * @param {string} end Block end time in HH:MM format.
   * @param {string} label Human-readable name of the calendar event (e.g. "Doctor appointment").
   * @returns {Promise<Array<object>>} Updated full list of stored calendar blocks after the addition.
   */
  async addBlock(date, start, end, label) {
    const blocks = await this.getBlocks();
    blocks.push({ date, start, end, label, created: new Date().toISOString() });
    await this.context.set(this.CONTEXT_KEY, blocks);
    return blocks;
  }

  /**
   * Removes a calendar block by index.
   * @param {number} index Zero-based position of the block to remove in the stored array.
   * @returns {Promise<Array<object>>} Updated full list of stored calendar blocks after the removal.
   */
  async removeBlock(index) {
    const blocks = await this.getBlocks();
    if (index >= 0 && index < blocks.length) {
      blocks.splice(index, 1);
      await this.context.set(this.CONTEXT_KEY, blocks);
    }
    return blocks;
  }

  /**
   * Returns blocks for a specific date, formatted as occupied slots for the prompt.
   * @param {string} date Target date in YYYY-MM-DD format used to filter stored blocks.
   * @returns {Promise<Array<object>>} Blocks matching the date, each shaped as { start, end, duration, name, immovable: true }.
   */
  async getBlocksForDate(date) {
    const blocks = await this.getBlocks();
    return blocks
      .filter(b => b.date === date)
      .map(b => ({
        start: b.start,
        end: b.end,
        duration: this.diffMinutes(b.end, b.start),
        name: b.label,
        immovable: true
      }));
  }

  /**
   * Calculates difference in minutes between end and start HH:MM strings.
   * @param {string} end End time in HH:MM format.
   * @param {string} start Start time in HH:MM format to subtract from end, wrapping correctly across midnight.
   * @returns {number} Duration in minutes (always non-negative, range 0–1439).
   */
  diffMinutes(end, start) {
    const [eh, em] = end.split(':').map(Number);
    const [sh, sm] = start.split(':').map(Number);
    return ((eh * 60 + em) - (sh * 60 + sm) + 1440) % 1440;
  }
}
