/**
 * Cloudflare Vectorize integration for semantic memory of learned rules.
 */
export class VectorizeManager {
  /**
   *
   * @param env The parameter.
   */
  constructor(env) {
    this.ai = env.AI;
    this.vectorize = env.VECTORIZE;
    // BGE embedding model: 768 dimensions
    this.model = '@cf/baai/bge-base-en-v1.5';
  }

  /**
   * Generates embedding and stores a rule in Vectorize.
   * @param ruleId The parameter.
   * @param ruleText The parameter.
   * @param metadata The parameter.
   */
  async insertRule(ruleId, ruleText, metadata) {
    const embedding = await this.ai.run(this.model, { text: ruleText });

    await this.vectorize.insert([{
      id: ruleId,
      values: embedding.data[0],
      metadata: {
        ...metadata,
        rule_text: ruleText
      }
    }]);
  }

  /**
   * Performs semantic search for relevant rules based on current context.
   * @param contextText The parameter.
   * @param limit The parameter.
   * @returns {any} The return value.
   */
  async searchRelevantRules(contextText, limit = 10) {
    const queryEmbedding = await this.ai.run(this.model, { text: contextText });

    const results = await this.vectorize.query(queryEmbedding.data[0], {
      topK: limit,
      returnMetadata: true
    });

    return results.matches.map(m => ({
      ...m.metadata,
      relevance: m.score
    }));
  }

  /**
   * Utility to build a context string for rule searching.
   * @param date The parameter.
   * @param dayName The parameter.
   * @param tasks The parameter.
   * @returns {any} The return value.
   */
  static buildSearchQuery(date, dayName, tasks) {
    const taskList = tasks.map(t => t.name).join(', ');
    return `Scheduling tasks [${taskList}] for ${dayName}, ${date}.`;
  }
}
