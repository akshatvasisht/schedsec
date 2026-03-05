/**
 * SchedSec Custom Error Classes
 */

/**
 * Base error class for all SchedSec errors.
 */
export class SchedSecError extends Error {
  /**
   * @param {string} message Error message.
   * @param {string} [code='UNKNOWN'] Machine-readable error code.
   */
  constructor(message, code = 'UNKNOWN') {
    super(message);
    this.name = 'SchedSecError';
    this.code = code;
  }
}

/**
 * Wrapper for raw Notion API failures.
 */
export class NotionAPIError extends SchedSecError {
  /**
   * @param {number} status HTTP status code.
   * @param {Object} body Error body from Notion.
   */
  constructor(status, body) {
    super(`Notion API error (HTTP ${status})`, 'NOTION_API');
    this.name = 'NotionAPIError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Thrown when task dependencies form a non-resolvable cycle.
 */
export class DependencyCycleError extends SchedSecError {
  /**
   * @param {Array<string>} cycle List of task IDs in the cycle.
   */
  constructor(cycle) {
    super(`Circular dependency detected: ${cycle.join(' -> ')}`, 'DEPENDENCY_CYCLE');
    this.name = 'DependencyCycleError';
    this.cycle = cycle;
  }
}

/**
 * Thrown when the AI returns malformed JSON after all retry attempts.
 */
export class InvalidJSONError extends SchedSecError {
  /**
   * @param {string} rawResponse The unparsable string from the AI.
   * @param {number} [attempts=3] How many parse attempts were made.
   */
  constructor(rawResponse, attempts = 3) {
    super(`AI returned invalid JSON after ${attempts} attempts`, 'INVALID_JSON');
    this.name = 'InvalidJSONError';
    this.rawResponse = rawResponse;
    this.attempts = attempts;
  }
}

/**
 * Thrown when the AI scheduling call fails entirely (quota, model error, etc.).
 */
export class AISchedulingError extends SchedSecError {
  /**
   * @param {string} reason Human-readable failure reason.
   * @param {number} [attempts=3] How many scheduling attempts were made.
   */
  constructor(reason, attempts = 3) {
    super(`AI scheduling failed after ${attempts} attempts: ${reason}`, 'AI_SCHEDULING_FAILED');
    this.name = 'AISchedulingError';
    this.attempts = attempts;
  }
}
