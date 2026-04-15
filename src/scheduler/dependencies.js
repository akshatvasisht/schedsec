import { DependencyCycleError } from '../errors.js';
import { timeToMinutes } from '../utils/time.js';

/**
 * Handles task dependency resolution and cycle detection.
 */
export class DependencyResolver {
  /**
   * Sorts tasks topologically based on their dependencies.
   * Throws DependencyCycleError if a cycle is detected.
   * @param {Array<object>} tasks Tasks with `id` and optional `dependsOn` array of dependency IDs.
   * @returns {Array<object>} Tasks ordered so every dependency appears before its dependents.
   */
  static topologicalSort(tasks) {
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const result = [];
    const visited = new Set();
    const visiting = new Set();

    const visit = (taskId) => {
      if (visiting.has(taskId)) {
        throw new DependencyCycleError([taskId, taskMap.get(taskId)?.name || taskId]);
      }
      if (visited.has(taskId)) return;

      visiting.add(taskId);
      const task = taskMap.get(taskId);

      if (task && task.dependsOn) {
        for (const depId of task.dependsOn) {
          visit(depId);
        }
      }

      visiting.delete(taskId);
      visited.add(taskId);
      if (task) result.push(task);
    };

    for (const task of tasks) {
      visit(task.id);
    }

    return result;
  }

  /**
   * Identifies all direct and indirect dependencies for a task.
   * @param {string} taskId ID of the task whose dependency tree to collect.
   * @param {Array<object>} tasks Full task list used to resolve dependency IDs.
   * @returns {Array<string>} Flat list of all transitive dependency IDs (no duplicates).
   */
  static getAllDependencies(taskId, tasks) {
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const deps = new Set();

    const collect = (id) => {
      const task = taskMap.get(id);
      if (!task || !task.dependsOn) return;

      for (const depId of task.dependsOn) {
        if (!deps.has(depId)) {
          deps.add(depId);
          collect(depId);
        }
      }
    };

    collect(taskId);
    return Array.from(deps);
  }

  /**
   * Calculates the latest possible start time for a task with a must_complete_by constraint.
   * Returns null if the task cannot fit before the deadline.
   * @param {object} task Task with `must_complete_by` (HH:MM) and `duration` (minutes) fields.
   * @param {string} workHoursEnd Work day end time (HH:MM) used as a hard cap on the deadline.
   * @returns {string|null} Latest valid start time in HH:MM format, or null if the task cannot fit.
   */
  static calculateLatestStartTime(task, workHoursEnd = '17:00') {
    if (!task.must_complete_by) return null;

    const deadlineMinutes = timeToMinutes(task.must_complete_by);
    const endMinutes = timeToMinutes(workHoursEnd);
    const effectiveDeadline = Math.min(deadlineMinutes, endMinutes);

    const duration = task.duration || 60;
    const latestStart = effectiveDeadline - duration;

    if (latestStart < 0) return null;

    const hours = String(Math.floor(latestStart / 60)).padStart(2, '0');
    const mins = String(latestStart % 60).padStart(2, '0');
    return `${hours}:${mins}`;
  }

}
