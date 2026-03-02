import { FallbackScheduler } from '../scheduler/fallback.js';
import { CONFIG } from '../config.js';

/**
 * In-memory what-if scenario generation.
 * Generates a schedule without writing to Notion.
 */
export class PlanningManager {
  /**
   * Generates a preview with temporary modifications.
   * @param baseTasks The parameter.
   * @param modifications The parameter.
   * @returns {any} The return value.
   */
  static generateScenario(baseTasks, modifications) {
    let tasks = [...baseTasks];

    // Add tasks
    if (modifications.add_tasks) {
      tasks.push(...modifications.add_tasks.map(t => ({
        ...t,
        id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        status: CONFIG.STATUS.TASK.ACTIVE
      })));
    }

    // Remove tasks
    if (modifications.remove_tasks) {
      tasks = tasks.filter(t => !modifications.remove_tasks.includes(t.id));
    }

    // Modify tasks
    if (modifications.modify_tasks) {
      for (const mod of modifications.modify_tasks) {
        const index = tasks.findIndex(t => t.id === mod.id);
        if (index !== -1) {
          tasks[index] = { ...tasks[index], ...mod };
        }
      }
    }

    // Use FallbackScheduler for instant preview result 
    // (In production this would usually call the AI worker)
    const preview = FallbackScheduler.generate(tasks);

    return {
      success: true,
      data: preview,
      modifications_applied: modifications
    };
  }

  /**
   * HTTP handler for /planning: generates what-if scenario from request body.
   * @param {Array} tasks - Base tasks (or empty to fetch from Inputs).
   * @param {Object} modifications - { add_tasks, remove_tasks, modify_tasks }.
   * @param {Object} env - Worker env (used if tasks empty to fetch from Notion).
   * @param {string} dateStr - Target date (YYYY-MM-DD).
   * @returns {Promise<Object>} Scenario result.
   */
  static async generateWhatIf(tasks, modifications, env, dateStr) {
    let baseTasks = Array.isArray(tasks) ? tasks : [];
    const mods = modifications || { add_tasks: [], remove_tasks: [], modify_tasks: [] };

    if (baseTasks.length === 0 && env?.INPUTS_DB_ID && env?.NOTION_API_KEY) {
      const { NotionClient } = await import('../notion-client.js');
      const { CONFIG } = await import('../config.js');
      const notion = new NotionClient(env.NOTION_API_KEY);
      const P = CONFIG.PROPERTIES;
      const res = await notion.queryDatabase(env.INPUTS_DB_ID, {
        property: P.INPUTS.STATUS,
        select: { equals: CONFIG.STATUS.TASK.ACTIVE }
      });
      baseTasks = res.results.map(page => {
        const props = page.properties;
        return {
          id: page.id,
          name: props[P.INPUTS.TASK_NAME]?.title?.[0]?.plain_text || '',
          type: props[P.INPUTS.TYPE]?.select?.name || 'TASK',
          duration: props[P.INPUTS.DURATION]?.number || 60,
          priority: props[P.INPUTS.PRIORITY]?.select?.name || null,
          energy: props[P.INPUTS.ENERGY]?.select?.name || null,
          status: CONFIG.STATUS.TASK.ACTIVE
        };
      });
    }

    return PlanningManager.generateScenario(baseTasks, mods);
  }
}
