import assert from 'node:assert/strict';
import test from 'node:test';
import { BriefError, verifyRequestedModel } from '../lib/brief-contract.ts';
import { llmPolicy } from '../lib/llm-policy.ts';

const catalog = {
  data: [
    {
      id: 'openai/gpt-5.6-luna',
      name: 'OpenAI: GPT-5.6 Luna',
      supported_parameters: [
        'reasoning',
        'max_tokens',
        'response_format',
        'structured_outputs',
      ],
      reasoning: {
        supported_efforts: ['max', 'xhigh', 'high', 'medium', 'low', 'none'],
      },
      top_provider: { max_completion_tokens: 128000 },
    },
  ],
};

void test('model selection preserves exact Luna while choosing balanced reasoning', () => {
  assert.deepEqual(verifyRequestedModel(catalog, 'openai/gpt-5.6-luna'), {
    id: 'openai/gpt-5.6-luna',
    effort: 'medium',
    maxTokens: 128000,
  });
  const higherMissing = structuredClone(catalog);
  higherMissing.data[0].reasoning.supported_efforts = ['medium', 'high'];
  higherMissing.data[0].top_provider.max_completion_tokens = 8192;
  assert.deepEqual(verifyRequestedModel(higherMissing, 'openai/gpt-5.6-luna'), {
    id: 'openai/gpt-5.6-luna',
    effort: 'medium',
    maxTokens: 8192,
  });
  assert.throws(
    () => verifyRequestedModel(catalog, 'openai/gpt-5.6-luna-pro'),
    BriefError,
  );
  assert.throws(
    () => verifyRequestedModel({ data: [] }, 'openai/gpt-5.6-luna'),
    BriefError,
  );
  const incompatible = structuredClone(catalog);
  incompatible.data[0].supported_parameters = ['reasoning'];
  assert.throws(
    () => verifyRequestedModel(incompatible, 'openai/gpt-5.6-luna'),
    BriefError,
  );
  const noReasoningMetadata = { data: [{ ...catalog.data[0], reasoning: {} }] };
  assert.throws(
    () => verifyRequestedModel(noReasoningMetadata, 'openai/gpt-5.6-luna'),
    BriefError,
  );
});

void test('every active AI path uses a bounded demo-safe generation profile', () => {
  assert.deepEqual(llmPolicy.generation, {
    analysis: { effort: 'medium', maxTokens: 6_000, timeoutMs: 60_000 },
    testCases: { effort: 'medium', maxTokens: 8_000, timeoutMs: 75_000 },
    memory: { effort: 'medium', maxTokens: 3_000, timeoutMs: 45_000 },
  });
  assert.ok(
    Object.values(llmPolicy.generation).every(
      (profile) => profile.maxTokens <= 8_000 && profile.timeoutMs <= 75_000,
    ),
  );
});
