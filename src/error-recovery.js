
/**
 * Intelligent error recovery system for SchedSec.
 * Uses a strategy pattern to handle specific errors.
 */
export class ErrorRecoverySystem {
  /**
   *
   * @param logger The parameter.
   */
  constructor(logger) {
    this.logger = logger;
    this.errorCounts = new Map();
    this.maxRetries = 3;

    // Binding strategies
    this.strategies = {
      'RATE_LIMIT': this.handleRateLimit.bind(this),
      'INVALID_JSON': this.handleInvalidJSON.bind(this),
      'NOTION_API_ERROR': this.handleNotionError.bind(this)
    };
  }

  /**
   * Main recovery entry point.
   * @param error The parameter.
   * @param context The parameter.
   * @param env The parameter.
   * @returns {any} The return value.
   */
  async recover(error, context, env = null) {
    const errorType = error.code || error.name;
    const strategy = this.strategies[errorType];

    const currentCount = (this.errorCounts.get(errorType) || 0) + 1;
    this.errorCounts.set(errorType, currentCount);

    if (!strategy || currentCount > this.maxRetries) {
      await this.logger.error(`Recovery failed for ${errorType}: ${error.message}`, {
        count: currentCount,
        context
      });
      await ErrorRecoverySystem.notifyError(
        `SchedSec: ${errorType} failed after ${currentCount} attempts — ${error.message}`, env
      );
      throw error; // Escalation
    }

    await this.logger.warn(`Recovering from ${errorType} (attempt ${currentCount})`, { message: error.message });
    return strategy(error, context);
  }

  /**
   * Sends a push notification via ntfy.sh if NTFY_TOPIC is configured.
   * Gracefully no-ops if not set.
   * @param message The parameter.
   * @param env The parameter.
   */
  static async notifyError(message, env) {
    if (!env?.NTFY_TOPIC) return;

    try {
      await fetch(`https://ntfy.sh/${env.NTFY_TOPIC}`, {
        method: 'POST',
        body: message,
        headers: { 'Title': 'SchedSec Alert', 'Priority': '4' }
      });
    } catch {
      // Swallow notification failures — logging is sufficient
    }
  }

  /**
   * Strategic Handlers
   */

  /**
   *
   * @param _error The parameter.
   * @param _context The parameter.
   * @returns {any} The return value.
   */
  async handleRateLimit(_error, _context) {
    const delay = Math.pow(2, this.errorCounts.get('RATE_LIMIT')) * 1000;
    await new Promise(r => { setTimeout(r, delay); });
    return { action: 'RETRY', delay };
  }

  /**
   *
   * @param _error The parameter.
   * @param _context The parameter.
   * @returns {any} The return value.
   */
  async handleInvalidJSON(_error, _context) {
    // Strategy: If AI failed to return valid JSON, retry with a more forceful instruction 
    // or return a flag to the caller to adjust the prompt.
    return { action: 'RETRY_WITH_FORCEFUL_PROMPT' };
  }

  /**
   *
   * @param error The parameter.
   * @param _context The parameter.
   * @returns {any} The return value.
   */
  async handleNotionError(error, _context) {
    if (error.details?.status === 502 || error.details?.status === 504) {
      // Temporary gateway issues
      await new Promise(r => { setTimeout(r, 2000); });
      return { action: 'RETRY' };
    }
    throw error; // Permanent errors should not be retried automatically here
  }

  /**
   *
   */
  resetCounts() {
    this.errorCounts.clear();
  }
}
