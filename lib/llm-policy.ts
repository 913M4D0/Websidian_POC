/** Public intent, not runtime readiness. Server secrets never belong in this module.
 * Verified 2026-09-04: https://openrouter.ai/api/v1/models
 * Runtime still checks the live catalog before enabling a provider request.
 */
export const llmPolicy = {
  enabled: true,
  provider: 'OpenRouter',
  requestedModel: 'GPT 5.6 Luna',
  modelId: 'openai/gpt-5.6-luna',
  reasoning: 'maximum-supported',
  retrieval: 'rank-without-taxonomy-gates',
  extraContentFilters: false,
  preservePrivacyAndAccessControls: true,
} as const;
