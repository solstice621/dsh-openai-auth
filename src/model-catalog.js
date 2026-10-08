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

const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value);

// Keep only data needed by the picker; never retain raw RPC objects or URLs.
export function normalizeDiscoveredModels(rows) {
  if (!Array.isArray(rows) || rows.length > 1000) throw new Error('Invalid model catalog');
  const seen = new Set(), models = [];
  for (const row of rows) {
    if (!row || row.hidden === true || !validId(row.model ?? row.id)) continue;
    const id = row.model ?? row.id;
    if (seen.has(id)) continue;
    const input = row.inputModalities === undefined ? ['text', 'image']
      : Array.isArray(row.inputModalities) ? [...new Set(row.inputModalities.filter(value => value === 'text' || value === 'image'))] : [];
    if (!input.includes('text')) continue;
    const name = typeof row.displayName === 'string' && row.displayName.trim() ? row.displayName.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 128) : id;
    const efforts = Array.isArray(row.supportedReasoningEfforts)
      ? [...new Set(row.supportedReasoningEfforts.map(value => value?.reasoningEffort).filter(value => value === 'none' || (value !== 'off' && levels.includes(value))))] : null;
    models.push({ id, name: name || id, input, efforts }); seen.add(id);
  }
  if (!models.length) throw new Error('Empty model catalog');
  return models;
}

export function mergeCodexModels(baseline, discovered) {
  const native = new Map(baseline.map(model => [model.id, model]));
  const template = baseline.find(model => model.api === 'openai-codex-responses');
  if (!template) return baseline;
  const models = discovered.map(entry => {
    const known = native.get(entry.id);
    const model = { ...structuredClone(known ?? template), id: entry.id, name: entry.name, input: [...entry.input] };
    if (!known) {
      // model/list does not report token limits or prices. These are conservative
      // local budgets, not claims about the new model's server-side capacity.
      model.contextWindow = 16384; model.maxTokens = 4096;
      model.cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      model.reasoning = false; delete model.thinkingLevelMap;
      delete model.compat; // do not infer advanced tools from a different model
    }
    if (entry.efforts !== null) {
      model.reasoning = entry.efforts.length > 0;
      model.thinkingLevelMap = Object.fromEntries(levels.map(level => [level,
        entry.efforts.includes(level) ? level : level === 'off' && entry.efforts.includes('none') ? 'none' : null]));
    }
    return model;
  });
  const remoteIds = new Set(discovered.map(entry => entry.id));
  // Preserve previous choices when an older CLI omits an otherwise usable model.
  return [...models, ...baseline.filter(model => !remoteIds.has(model.id))];
}
