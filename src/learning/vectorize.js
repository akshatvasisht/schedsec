/**
 * Cloudflare Vectorize integration for semantic memory of learned rules.
 */
export class VectorizeManager {
  /**
   * @param {object} env Cloudflare Worker environment object containing AI and VECTORIZE bindings.
   */
  constructor(env) {
    this.ai = env.AI;
    this.vectorize = env.VECTORIZE;
    // BGE embedding model: 768 dimensions
    this.model = '@cf/baai/bge-base-en-v1.5';
  }

  /**
   * Generates embedding and stores a rule in Vectorize.
   * @param {string} ruleId Unique identifier for the rule vector, used as the Vectorize document ID.
   * @param {string} ruleText Human-readable rule text that is embedded via the BGE model.
   * @param {object} metadata Arbitrary key-value pairs stored alongside the vector for retrieval (e.g. confidence, source).
   * @returns {Promise<void>} Resolves when the upsert to Vectorize completes.
   */
  async insertRule(ruleId, ruleText, metadata) {
    const embedding = await this.ai.run(this.model, { text: ruleText });

    await this.vectorize.upsert([{
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
   * @param {string} contextText Natural language description of today's scheduling context, embedded for similarity search.
   * @param {number} limit Maximum number of matching rules to return from Vectorize.
   * @returns {Promise<Array<object>>} Matched rule metadata objects with an added relevance score field.
   */
  async searchRelevantRules(contextText, limit = 10) {
    const queryEmbedding = await this.ai.run(this.model, { text: contextText });

    const results = await this.vectorize.query(queryEmbedding.data[0], {
      topK: limit,
      returnMetadata: true
    });

    return (results?.matches ?? []).map(m => ({
      ...m.metadata,
      relevance: m.score
    }));
  }

  /**
   * Utility to build a context string for rule searching.
   * @param {string} date ISO date string (YYYY-MM-DD) for the day being scheduled.
   * @param {string} dayName Human-readable day name (e.g. "Monday") included in the query string.
   * @param {Array<object>} tasks Task objects with a name field, whose names are listed in the query.
   * @returns {string} Formatted query string suitable for passing to searchRelevantRules.
   */
  static buildSearchQuery(date, dayName, tasks) {
    const taskList = tasks.map(t => t.name).join(', ');
    return `Scheduling tasks [${taskList}] for ${dayName}, ${date}.`;
  }
}
