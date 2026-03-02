import { CONFIG } from './config.js';

/**
 * Structured logger that writes to both console and Notion Logs DB.
 */
export class Logger {
  /**
   * Initializes the structured logger.
   * @param {NotionClient} notionClient Shared Notion API client.
   * @param {string} logsDbId Target database ID for logging.
   */
  constructor(notionClient, logsDbId) {
    this.notion = notionClient;
    this.logsDbId = logsDbId;
  }

  /**
   * Dispatches log entry to console and optionally Notion.
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
  }

  /**
   *
   * @param message The parameter.
   * @param context The parameter.
   * @returns {any} The return value.
   */
  async info(message, context) { return this.log('INFO', message, context); }
  /**
   *
   * @param message The parameter.
   * @param context The parameter.
   * @returns {any} The return value.
   */
  async warn(message, context) { return this.log('WARN', message, context); }
  /**
   *
   * @param message The parameter.
   * @param context The parameter.
   * @returns {any} The return value.
   */
  async error(message, context) { return this.log('ERROR', message, context); }
}
