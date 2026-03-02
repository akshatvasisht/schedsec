
/**
 * Analyzes dependency chains to detect infeasible deadlines.
 */
export class CriticalPathAnalyzer {
  /**
   * Calculates the critical path duration for all tasks with deadlines.
   * Returns feasibility status and any violations found.
   * @param tasks The parameter.
   * @returns {any} The return value.
   */
  static calculateCriticalPath(tasks) {
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const pathCache = new Map();

    const getPathDuration = (taskId) => {
      if (pathCache.has(taskId)) return pathCache.get(taskId);

      const task = taskMap.get(taskId);
      if (!task) return 0;

      const deps = task.dependsOn || [];
      if (deps.length === 0) {
        const duration = task.estimatedDays || 1;
        pathCache.set(taskId, duration);
        return duration;
      }

      const maxDepPath = Math.max(
        ...deps.map(depId => getPathDuration(depId))
      );

      const totalPath = maxDepPath + (task.estimatedDays || 1);
      pathCache.set(taskId, totalPath);
      return totalPath;
    };

    const violations = [];

    for (const task of tasks.filter(t => t.deadline)) {
      const pathDuration = getPathDuration(task.id);
      const daysUntilDeadline = Math.ceil(
        (new Date(task.deadline) - new Date()) / (1000 * 60 * 60 * 24)
      );

      if (pathDuration > daysUntilDeadline) {
        violations.push({
          task: task.name,
          taskId: task.id,
          needed: pathDuration,
          available: daysUntilDeadline,
          shortfall: pathDuration - daysUntilDeadline,
          criticalPath: CriticalPathAnalyzer.reconstructPath(task.id, taskMap)
        });
      }
    }

    if (violations.length > 0) {
      return {
        feasible: false,
        violations,
        message: violations.map(v =>
          `${v.task} needs ${v.needed} days but deadline is ${v.available} days away`
        ).join('; ')
      };
    }

    return { feasible: true, violations: [] };
  }

  /**
   * Reconstructs the longest dependency path for a given task.
   * @param taskId The parameter.
   * @param taskMap The parameter.
   * @returns {any} The return value.
   */
  static reconstructPath(taskId, taskMap) {
    const path = [];
    const task = taskMap.get(taskId);
    if (!task) return path;

    path.push(task.name || taskId);

    const deps = task.dependsOn || [];
    if (deps.length > 0) {
      const longestDep = deps
        .map(depId => ({
          id: depId,
          path: CriticalPathAnalyzer.reconstructPath(depId, taskMap)
        }))
        .sort((a, b) => b.path.length - a.path.length)[0];

      path.unshift(...longestDep.path);
    }

    return path;
  }
}
