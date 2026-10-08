import test from 'node:test';
import assert from 'node:assert/strict';
import { supplementCodexModels } from '../src/model-catalog.js';

const native = {
  id: 'gpt-6-sol', name: 'GPT-6 Sol', api: 'openai-codex-responses',
  provider: 'openai-codex', baseUrl: 'https://chatgpt.com/backend-api',
  contextWindow: 272000, maxTokens: 128000,
  compat: { supportsOpenAIGrammarTools: true },
  inputLimits: { images: { resize: { maxWidth: 2000 } } },
  thinkingLevelMap: { off: 'none', minimal: 'low', low: 'low' },
};

test('supplements old catalogs with the exact model and supported reasoning efforts', () => {
  const [sol] = supplementCodexModels([native]);
  assert.equal(sol.id, 'gpt-6.1-sol');
  assert.equal(sol.name, 'GPT-6.1 Sol');
  assert.equal(sol.api, native.api);
  assert.equal(sol.baseUrl, native.baseUrl);
  assert.equal(sol.contextWindow, native.contextWindow);
  assert.deepEqual(sol.input, ['text', 'image']);
  assert.deepEqual(sol.thinkingLevelMap, {
    off: null, minimal: null,
    low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max',
  });
});

test('preserves native entries and does not share mutable supplemental metadata', () => {
  const input = [structuredClone(native)];
  const before = structuredClone(input);
  const result = supplementCodexModels(input);
  assert.equal(result[1], input[0]);
  result[0].inputLimits.images.resize.maxWidth = 1;
  result[0].compat.supportsOpenAIGrammarTools = false;
  assert.deepEqual(input, before);
});

test('prefers upstream model metadata when the native catalog catches up', () => {
  const upstream = { ...native, id: 'gpt-6.1-sol', contextWindow: 999999 };
  const input = [native, upstream];
  assert.equal(supplementCodexModels(input), input);
  assert.equal(supplementCodexModels(input).filter(model => model.id === upstream.id).length, 1);
});

test('never borrows a different wire protocol', () => {
  const input = [{ ...native, api: 'openai-responses' }];
  assert.equal(supplementCodexModels(input), input);
});
