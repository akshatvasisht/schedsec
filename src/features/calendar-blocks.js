
/**
 * External Calendar Block Management
 * Manages immovable external calendar events that block scheduling slots.
 */
export class CalendarBlocks {
  /**
   *
   * @param context The parameter.
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
   * @param date The parameter.
   * @param start The parameter.
   * @param end The parameter.
   * @param label The parameter.
   * @returns {any} The return value.
   */
  async addBlock(date, start, end, label) {
    const blocks = await this.getBlocks();
    blocks.push({ date, start, end, label, created: new Date().toISOString() });
    await this.context.set(this.CONTEXT_KEY, blocks);
    return blocks;
  }

  /**
   * Removes a calendar block by index.
   * @param index The parameter.
   * @returns {any} The return value.
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
   * @param date The parameter.
   * @returns {any} The return value.
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
   * @param end The parameter.
   * @param start The parameter.
   * @returns {any} The return value.
   */
  diffMinutes(end, start) {
    const [eh, em] = end.split(':').map(Number);
    const [sh, sm] = start.split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
  }
}
