import test from 'node:test';
import assert from 'node:assert/strict';
import { supplementCodexModels } from '../src/model-catalog.js';

const native = {
  id: 'gpt-6-sol', name: 'GPT-6 Sol', api: 'openai-codex-responses',
  provider: 'openai-codex', baseUrl: 'https://chatgpt.com/backend-api',
  contextWindow: 272000, maxTokens: 128000,
  cost: { input: 2, output: 10 },
  compat: { supportsOpenAIGrammarTools: true },
  inputLimits: { images: { resize: { maxWidth: 2000 } } },
  thinkingLevelMap: { off: 'none', minimal: 'low', low: 'low' },
};

test('supplements old catalogs with later Codex models and their real budgets', () => {
  const models = supplementCodexModels([native]);
  const later = Object.fromEntries(['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6.2-sol', 'gpt-6.2-astra']
    .map(id => [id, models.find(model => model.id === id)]));
  for (const model of Object.values(later)) {
    assert.equal(model.api, native.api);
    assert.equal(model.baseUrl, native.baseUrl);
    assert.deepEqual(model.input, ['text', 'image']);
    assert.equal(model.reasoning, true);
    assert.equal(model.maxTokens, 128000);
  }
  assert.equal(later['gpt-6.1-sol'].name, 'GPT-6.1 Sol');
  assert.equal(later['gpt-6.1-sol'].contextWindow, 500000);
  assert.equal(later['gpt-6.1-terra'].contextWindow, 500000);
  assert.equal(later['gpt-6.2-sol'].contextWindow, 500000);
  assert.equal(later['gpt-6.2-astra'].contextWindow, 272000);
  assert.deepEqual(later['gpt-6.1-sol'].thinkingLevelMap, {
    off: null, minimal: 'low',
    low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max',
  });
  assert.equal(models.at(-1), native);
});

test('preserves native entries and does not share mutable supplemental metadata', () => {
  const input = [structuredClone(native)];
  const before = structuredClone(input);
  const result = supplementCodexModels(input);
  assert.equal(result.at(-1), input[0]);
  result[0].inputLimits.images.resize.maxWidth = 1;
  result[0].compat.supportsOpenAIGrammarTools = false;
  assert.deepEqual(input, before);
});

test('prefers upstream model metadata when the native catalog catches up', () => {
  const upstreamIds = ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6.2-sol', 'gpt-6.2-astra'];
  const input = [native, ...upstreamIds.map(id => ({ ...native, id, contextWindow: 999999 }))];
  assert.equal(supplementCodexModels(input), input);
  assert.equal(supplementCodexModels(input).filter(model => model.id === 'gpt-6.1-sol').length, 1);
});

test('never borrows a different wire protocol', () => {
  const input = [{ ...native, api: 'openai-responses' }];
  assert.equal(supplementCodexModels(input), input);
});
