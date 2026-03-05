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
   * @param {Object} [env=null] Environment bindings (for NTFY_TOPIC push alerts).
   */
  constructor(notionClient, logsDbId, env = null) {
    this.notion = notionClient;
    this.logsDbId = logsDbId;
    this.ntfyTopic = env?.NTFY_TOPIC || null;
  }

  /**
   * Dispatches log entry to console and optionally Notion.
   * ERROR-level logs also trigger push notification if NTFY_TOPIC is set.
   * @param {string} level Log level (INFO, WARN, ERROR).
   * @param {string} message Descriptive log message.
   * @param {Object} [context={}] Additional metadata for the log.
   */
  async log(level, message, context = {}) {
    console.log(`[${level}] ${message}`, context);

    if (!this.logsDbId) return;

    try {
      const props = CONFIG.PROPERTIES.LOGS;
      await this.notion.createPage(this.logsDbId, {
        [props.MESSAGE]: {
          title: [{ text: { content: message.substring(0, 2000) } }]
        },
        [props.LEVEL]: {
          select: { name: level }
        },
        [props.TIMESTAMP]: {
          date: { start: new Date().toISOString() }
        },
        [props.CONTEXT]: {
          rich_text: [{ text: { content: JSON.stringify(context).substring(0, 2000) } }]
        }
      });
    } catch (error) {
      console.error('Failed to write to Notion logs:', error);
    }

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
   * @param {string} message Log message.
   * @param {Object} [context] Additional metadata.
   */
  async info(message, context) { return this.log('INFO', message, context); }
  /**
   * @param {string} message Log message.
   * @param {Object} [context] Additional metadata.
   */
  async warn(message, context) { return this.log('WARN', message, context); }
  /**
   * @param {string} message Log message.
   * @param {Object} [context] Additional metadata.
   */
  async error(message, context) { return this.log('ERROR', message, context); }
}
