/** Public intent, not runtime readiness. Server secrets never belong in this module.
 * Verified 2026-09-04: https://openrouter.ai/api/v1/models
 * Runtime still checks the live catalog before enabling a provider request.
 */
export const llmPolicy = {
  enabled: true,
  provider: 'OpenRouter',
  requestedModel: 'GPT 5.6 Luna',
  modelId: 'openai/gpt-5.6-luna',
  reasoning: 'balanced-medium',
  generation: {
    analysis: { effort: 'medium', maxTokens: 6_000, timeoutMs: 60_000 },
    testCases: { effort: 'medium', maxTokens: 8_000, timeoutMs: 75_000 },
    memory: { effort: 'medium', maxTokens: 3_000, timeoutMs: 45_000 },
  },
  retrieval: 'rank-without-taxonomy-gates',
  extraContentFilters: false,
  preservePrivacyAndAccessControls: true,
} as const;
