import { DependencyCycleError } from '../errors.js';

/**
 * Handles task dependency resolution and cycle detection.
 */
export class DependencyResolver {
  /**
   * Sorts tasks topologically based on their dependencies.
   * Throws DependencyCycleError if a cycle is detected.
   * @param tasks The parameter.
   * @returns {any} The return value.
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
   * @param taskId The parameter.
   * @param tasks The parameter.
   * @returns {any} The return value.
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
   * @param task The parameter.
   * @param workHoursEnd The parameter.
   * @returns {any} The return value.
   */
  static calculateLatestStartTime(task, workHoursEnd = '17:00') {
    if (!task.must_complete_by) return null;

    const deadlineMinutes = DependencyResolver.timeToMinutes(task.must_complete_by);
    const endMinutes = DependencyResolver.timeToMinutes(workHoursEnd);
    const effectiveDeadline = Math.min(deadlineMinutes, endMinutes);

    const duration = task.duration || 60;
    const latestStart = effectiveDeadline - duration;

    if (latestStart < 0) return null;

    const hours = String(Math.floor(latestStart / 60)).padStart(2, '0');
    const mins = String(latestStart % 60).padStart(2, '0');
    return `${hours}:${mins}`;
  }

  /**
   * Converts a HH:MM time string to minutes since midnight.
   * @param time The parameter.
   * @returns {any} The return value.
   */
  static timeToMinutes(time) {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }
}
