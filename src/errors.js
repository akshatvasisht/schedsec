/**
 * SchedSec Custom Error Classes
 */

/**
 *
 */
export class SchedSecError extends Error {
  /**
   * Base SchedSec error.
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
 *
 */
export class RateLimitError extends SchedSecError {
  /**
   * Thrown when Notion API rate limits are hit.
   * @param {number} [retryAfter=1000] Milliseconds to wait before retry.
   */
  constructor(retryAfter = 1000) {
    super(`Rate limited. Retry after ${retryAfter}ms`, 'RATE_LIMIT');
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 *
 */
export class InvalidJSONError extends SchedSecError {
  /**
   * Thrown when AI output is not valid JSON.
   * @param {string} rawResponse The unparsable string from the AI.
   */
  constructor(rawResponse) {
    super('AI returned invalid JSON', 'INVALID_JSON');
    this.name = 'InvalidJSONError';
    this.rawResponse = rawResponse;
  }
}

/**
 *
 */
export class NotionAPIError extends SchedSecError {
  /**
   * Wrapper for raw Notion API failures.
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
 *
 */
export class ConfigurationError extends SchedSecError {
  /**
   * Thrown when a required environment variable or config key is missing.
   * @param {string} missingKey Name of the missing configuration.
   */
  constructor(missingKey) {
    super(`Missing configuration: ${missingKey}`, 'CONFIG');
    this.name = 'ConfigurationError';
  }
}

/**
 *
 */
export class DependencyCycleError extends SchedSecError {
  /**
   * Thrown when task dependencies form a non-resolvable cycle.
   * @param {Array<string>} cycle List of task IDs in the cycle.
   */
  constructor(cycle) {
    super(`Circular dependency detected: ${cycle.join(' -> ')}`, 'DEPENDENCY_CYCLE');
    this.name = 'DependencyCycleError';
    this.cycle = cycle;
  }
}

/**
 *
 */
export class InfeasibleScheduleError extends SchedSecError {
  /**
   * Thrown when total tasks exceed available energy/time budget.
   * @param {string} reason Description of why it's infeasible.
   * @param {number} overage Amount (minutes/energy) over budget.
   */
  constructor(reason, overage) {
    super(`Infeasible schedule: ${reason}`, 'INFEASIBLE');
    this.name = 'InfeasibleScheduleError';
    this.overage = overage;
  }
}

/**
 *
 */
export class OptimisticLockError extends SchedSecError {
  /**
   * Thrown when an optimistic lock conflict occurs.
   * @param {string} taskId ID of the task being written.
   * @param {number} expectedVersion Version the worker expected to overwrite.
   * @param {number} actualVersion Current version in the database.
   */
  constructor(taskId, expectedVersion, actualVersion) {
    super(`Lock conflict on task ${taskId}: expected v${expectedVersion}, found v${actualVersion}`, 'OPTIMISTIC_LOCK_CONFLICT');
    this.name = 'OptimisticLockError';
    this.taskId = taskId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}
