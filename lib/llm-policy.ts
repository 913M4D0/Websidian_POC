/** Configuration intent only. No provider is called until an exact model ID is verified. */
export const llmPolicy = {
  enabled: false,
  provider: 'OpenRouter',
  requestedModel: 'GPT 5.6 Luna',
  modelId: null,
  reasoning: 'maximum-supported',
  retrieval: 'rank-without-taxonomy-gates',
  extraContentFilters: false,
  preservePrivacyAndAccessControls: true,
} as const;
