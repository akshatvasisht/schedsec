/**
 * Infers properties for new/unknown tasks from historically similar tasks.
 */
export class CollaborativeFilter {
  /**
   * Finds the top-3 most similar historical tasks using Jaccard similarity.
   * Minimum 20% similarity threshold.
   * @param newTask The parameter.
   * @param historicalTasks The parameter.
   * @returns {any} The return value.
   */
  static findSimilarTasks(newTask, historicalTasks) {
    const scores = historicalTasks.map(historical => ({
      task: historical,
      similarity: CollaborativeFilter.jaccardSimilarity(newTask.name, historical.name)
    }));

    return scores
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3)
      .filter(s => s.similarity > 0.2);
  }

  /**
   * Computes Jaccard similarity between two task names.
   * @param name1 The parameter.
   * @param name2 The parameter.
   * @returns {any} The return value.
   */
  static jaccardSimilarity(name1, name2) {
    if (!name1 || !name2) return 0;

    const words1 = new Set(name1.toLowerCase().split(/\s+/));
    const words2 = new Set(name2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }

  /**
   * Infers missing fields from the weighted average of similar tasks.
   * @param task The parameter.
   * @param historicalTasks The parameter.
   * @returns {any} The return value.
   */
  static inferFromSimilar(task, historicalTasks) {
    const similar = CollaborativeFilter.findSimilarTasks(task, historicalTasks);

    if (similar.length === 0) return task;

    const totalSimilarity = similar.reduce((sum, s) => sum + s.similarity, 0);

    const inferred = { ...task };

    if (!inferred.duration) {
      const weightedDuration = similar.reduce(
        (sum, s) => sum + (s.task.duration || 60) * s.similarity, 0
      );
      inferred.duration = Math.round(weightedDuration / totalSimilarity);
    }

    if (!inferred.energy) {
      inferred.energy = CollaborativeFilter.mostCommon(similar.map(s => s.task.energy));
    }

    if (!inferred.time_preference) {
      inferred.time_preference = CollaborativeFilter.mostCommon(similar.map(s => s.task.time_preference));
    }

    inferred.notes = (inferred.notes || '') +
            `\n[Inferred from similar tasks: ${similar.map(s => s.task.name).join(', ')}]`;

    return inferred;
  }

  /**
   * Returns the most common value in an array.
   * @param arr The parameter.
   * @returns {any} The return value.
   */
  static mostCommon(arr) {
    const filtered = arr.filter(Boolean);
    if (filtered.length === 0) return null;

    const counts = {};
    for (const val of filtered) {
      counts[val] = (counts[val] || 0) + 1;
    }

    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])[0][0];
  }
}
