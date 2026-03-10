import { CONFIG } from './config.js';

/**
 * Structured logger that writes to both console and Notion Logs DB.
 * Optionally pushes critical errors via ntfy.sh.
 */
export class Logger {
  /**
   * Initializes the structured logger.
   * @param {NotionClient} notionClient Shared Notion API client.
   * @param {string} logsDbId Target database ID for logging.
   * @param {object} [env] Environment bindings (for NTFY_TOPIC push alerts).
   */
  constructor(notionClient, logsDbId, env = null) {
    this.notion = notionClient;
    this.logsDbId = logsDbId;
    this.ntfyTopic = env?.NTFY_TOPIC || null;
    this.buffer = [];
  }

  /**
   * Dispatches log entry to console and optionally Notion.
   * ERROR-level logs also trigger push notification if NTFY_TOPIC is set.
   * @param {string} level Log level (INFO, WARN, ERROR).
   * @param {string} message Descriptive log message.
   * @param {object} [context={}] Additional metadata for the log.
   */
  async log(level, message, context = {}) {
    console.log(`[${level}] ${message}`, context);
    this.buffer.push({
      level,
      message: message.substring(0, 2000),
      context,
      timestamp: new Date().toISOString()
    });

    // Push critical errors via ntfy.sh
    if (level === 'ERROR') {
      await this.notifyPush(`SchedSec: ${message}`);
    }
  }

  /**
   * Sends a push notification via ntfy.sh if NTFY_TOPIC is configured.
   * Gracefully no-ops if not set. Swallows notification failures.
   * @param {string} message Alert message body.
   */
  async notifyPush(message) {
    if (!this.ntfyTopic) return;

    try {
      await fetch(`https://ntfy.sh/${this.ntfyTopic}`, {
        method: 'POST',
        body: message,
        headers: { 'Title': 'SchedSec Alert', 'Priority': '4' }
      });
    } catch {
      // Swallow notification failures — logging is sufficient
    }
  }

  /**
   * Logs an informational event.
   * @param {string} message Log message.
   * @param {object} [context] Additional metadata.
   * @returns {Promise<void>} Resolves when the log has been buffered.
   */
  async info(message, context) { return this.log('INFO', message, context); }
  /**
   * Logs a warning event.
   * @param {string} message Log message.
   * @param {object} [context] Additional metadata.
   * @returns {Promise<void>} Resolves when the log has been buffered.
   */
  async warn(message, context) { return this.log('WARN', message, context); }
  /**
   * Logs an error event.
   * @param {string} message Log message.
   * @param {object} [context] Additional metadata.
   * @returns {Promise<void>} Resolves when the log has been buffered.
   */
  async error(message, context) { return this.log('ERROR', message, context); }

  /**
   * Flushes buffered log entries to Notion Logs DB.
   * Keeps logging resilient by swallowing write failures.
   */
  async flush() {
    if (!this.logsDbId || this.buffer.length === 0) return;

    const props = CONFIG.PROPERTIES.LOGS;
    const entries = this.buffer.splice(0, this.buffer.length);

    for (const entry of entries) {
      try {
        await this.notion.createPage(this.logsDbId, {
          [props.MESSAGE]: {
            title: [{ text: { content: entry.message } }]
          },
          [props.LEVEL]: {
            select: { name: entry.level }
          },
          [props.TIMESTAMP]: {
            date: { start: entry.timestamp }
          },
          [props.CONTEXT]: {
            rich_text: [{ text: { content: JSON.stringify(entry.context).substring(0, 2000) } }]
          }
        });
      } catch (error) {
        console.error('Failed to write buffered log to Notion logs:', error);
      }
    }
  }
}
