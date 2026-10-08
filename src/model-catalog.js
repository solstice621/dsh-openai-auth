// Supplement older Desktop catalogs until their native provider includes Sol 6.1.
// Official metadata: https://developers.openai.com/api/docs/models/gpt-6.1-sol
export function supplementCodexModels(nativeModels) {
  if (nativeModels.some(model => model.id === 'gpt-6.1-sol')) return nativeModels;
  const template = nativeModels.find(model => model.id === 'gpt-6-sol' && model.api === 'openai-codex-responses')
    ?? nativeModels.find(model => model.api === 'openai-codex-responses');
  if (!template) return nativeModels;
  const model = {
    ...structuredClone(template),
    id: 'gpt-6.1-sol',
    name: 'GPT-6.1 Sol',
    reasoning: true,
    input: ['text', 'image'],
    // Keep the native Codex route's context budget. API context capacity is not
    // evidence of the subscription route's capacity in this Desktop version.
    maxTokens: 128000,
    thinkingLevelMap: {
      off: null, minimal: null,
      low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max',
    },
    cost: {
      input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5,
      tiers: [{ inputTokensAbove: 272000, input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5 }],
    },
  };
  return [model, ...nativeModels];
}
