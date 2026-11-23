// Models the ChatGPT Codex route serves but the host's bundled pi-ai catalog
// predates (Harness 0.2.2-rc.5 ships @earendil-works/pi-ai 1.3.0). Limits and
// prices come from @earendil-works/pi-ai 1.6.0's own openai-codex catalog for
// the same ChatGPT route: the best offline evidence available, not a live
// verification of the subscription route's capacity.
const laterCodexModels = [
  {
    id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol', contextWindow: 500000, maxTokens: 128000,
    cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5,
      tiers: [{ inputTokensAbove: 272000, input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5 }] },
  },
  {
    id: 'gpt-6.2-astra', name: 'GPT-6.2 Astra', contextWindow: 272000, maxTokens: 128000,
    cost: { input: 8, output: 40, cacheRead: 0.4, cacheWrite: 10,
      tiers: [{ inputTokensAbove: 272000, input: 16, output: 60, cacheRead: 0.8, cacheWrite: 20 }] },
  },
  {
    id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra', contextWindow: 500000, maxTokens: 128000,
    cost: { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25,
      tiers: [{ inputTokensAbove: 272000, input: 2, output: 7.5, cacheRead: 0.1, cacheWrite: 2.5 }] },
  },
  {
    id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', contextWindow: 500000, maxTokens: 128000,
    cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5,
      tiers: [{ inputTokensAbove: 272000, input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5 }] },
  },
];

const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
export const validModelId = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value);

export function supplementCodexModels(nativeModels) {
  const template = nativeModels.find(model => model.id === 'gpt-6-sol' && model.api === 'openai-codex-responses')
    ?? nativeModels.find(model => model.api === 'openai-codex-responses');
  if (!template) return nativeModels;
  const known = new Set(nativeModels.map(model => model.id));
  const additions = laterCodexModels.filter(spec => !known.has(spec.id)).map(spec => ({
    ...structuredClone(template),
    ...structuredClone(spec),
    reasoning: true,
    input: ['text', 'image'],
    thinkingLevelMap: {
      off: null, minimal: 'low',
      low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max',
    },
  }));
  return additions.length ? [...additions, ...nativeModels] : nativeModels;
}

// Keep only data needed by the picker; never retain raw RPC objects or URLs.
export function normalizeDiscoveredModels(rows) {
  if (!Array.isArray(rows) || rows.length > 1000) throw new Error('Invalid model catalog');
  const seen = new Set(), models = [];
  for (const row of rows) {
    if (!row || row.hidden === true || !validModelId(row.model ?? row.id)) continue;
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

export const validContextWindow = value => Number.isSafeInteger(value) && value > 0;

export function readContextWindows(catalog) {
  const rows = catalog?.models;
  if (!Array.isArray(rows) || rows.length > 1000) throw Error('Invalid Codex model catalog');
  const windows = new Map();
  for (const row of rows) {
    if (validModelId(row?.slug) && validContextWindow(row.context_window)) {
      windows.set(row.slug, row.context_window);
    }
  }
  return windows;
}

export function mergeCodexModels(baseline, discovered) {
  const native = new Map(baseline.map(model => [model.id, model]));
  const template = baseline.find(model => model.api === 'openai-codex-responses');
  if (!template) return baseline;
  const models = [];
  for (const entry of discovered) {
    const known = native.get(entry.id);
    const contextWindow = entry.contextWindow ?? known?.contextWindow;
    if (!validContextWindow(contextWindow)) continue;
    const model = {
      ...structuredClone(known ?? template), id: entry.id, name: entry.name, input: [...entry.input],
      contextWindow,
      // Codex's raw catalog supplies the context window. The output budget
      // comes from the exact same-route pi-ai model or a local default.
      maxTokens: Math.min(known?.maxTokens ?? 4096, contextWindow),
    };
    if (!known) {
      model.cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      model.reasoning = false;
      delete model.thinkingLevelMap;
      delete model.compat;
    }
    if (entry.efforts !== null) {
      model.reasoning = entry.efforts.length > 0;
      model.thinkingLevelMap = Object.fromEntries(levels.map(level => [level,
        entry.efforts.includes(level) ? level : level === 'off' && entry.efforts.includes('none') ? 'none' : null]));
    }
    models.push(model);
  }
  const remoteIds = new Set(discovered.map(entry => entry.id));
  // Preserve previous choices when an older CLI omits an otherwise usable model.
  return [...models, ...baseline.filter(model => !remoteIds.has(model.id))];
}
