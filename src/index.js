import Schema from '@deepseek-ai/schemastery';
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai';
import { LlmError, resolveRetryPolicy, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm';
import { installProxyFromEnvironment, proxyEnvironmentForChild, proxyRouteFor } from '@deepseek-ai/dsh-http-proxy';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { CodexTokenSource } from './codex-auth.js';
import { SystemProxyBridge } from './system-proxy.js';
import { AuthController, authRpcHandler } from './auth-controller.js';
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection';

export const name = 'dsh-openai-auth';
export const inject = ['llm', 'connection'];
export const PROVIDER = 'codex-subscription';
export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('Enable the Codex connection in Harness').volatile(),
  codexHome: Schema.string().description('Codex login directory; defaults to CODEX_HOME or ~/.codex'),
  codexCommand: Schema.string().default('codex').description('Official Codex CLI executable; an absolute path is useful on desktop'),
  refreshSkewSeconds: Schema.number().min(0).max(3600).default(300),
  useSystemProxy: Schema.boolean().default(process.platform === 'darwin').description('Use the active macOS HTTP proxy when the GUI Host has no explicit proxy'),
});

export function childEnvironment() {
  const environment = { ...process.env };
  for (const [key, value] of Object.entries(proxyEnvironmentForChild())) {
    if (value === undefined) delete environment[key];
    else environment[key] = value;
  }
  return environment;
}

// This adapter uses the host's provider catalog, wire protocol, history replay,
// tool-call conversion, image projection, cancellation and attribution headers.
export function createCodexAdapter(ctx, config = {}, sourceOverride, beforeAuth = async () => {}) {
  const source = sourceOverride ?? new CodexTokenSource({ ...config, childEnvironment });
  const native = openaiCodexProvider();
  const models = native.getModels().map(model => ({ ...model, provider: PROVIDER }));
  const provider = {
    ...native,
    id: PROVIDER,
    name: 'OpenAI · Codex 额度',
    // pi-ai's apiKey resolver is its generic bearer-token handoff. The token
    // comes exclusively from Codex OAuth; no Platform API key is accepted.
    auth: { apiKey: {
      name: 'Local Codex ChatGPT login',
      resolve: async ({ signal }) => {
        await beforeAuth();
        return { auth: { apiKey: await source.accessToken(signal) }, source: 'Codex ChatGPT login' };
      },
    } },
    getModels: () => models,
  };
  const profiles = new Map([[PROVIDER, {
    provider: PROVIDER,
    displayName: provider.name,
    piProvider: provider,
    transport: 'sse',
    streamIdleTimeoutMs: 300000,
    maxRequestImageBytes: 20971520,
    requestImagePixelBudget: 4194304,
    requestImageMaxBytes: 1048576,
    retryPolicy: resolveRetryPolicy({ mode: 'normal', maxRetries: 2 }, name),
    configuredMaxTokens: new Map(),
    modelErrors: new Map(),
  }]]);
  const adapter = new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: async () => undefined,
    auth: {
      credentials: {
        read: async () => undefined,
        list: async () => [],
        modify: async () => { throw new LlmError('Codex owns the login; use codex login.', 'CODEX_AUTH_REQUIRED'); },
        delete: async () => {},
      },
      authContext: { env: async () => undefined, fileExists: async () => false },
    },
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, path => ctx.get('fs')?.processPathFromHostPath(path), ref),
    onReplayDegrade: () => ctx.logger.warn('Codex response history fell back to provider-neutral content.'),
  });
  return adapter;
}

export async function apply(ctx, config) {
  const bridge = new SystemProxyBridge({
    enabled: config.useSystemProxy ?? process.platform === 'darwin',
    hostProxied: proxyRouteFor('https://chatgpt.com/backend-api/codex/responses').proxied,
    install: installProxyFromEnvironment,
    report: message => ctx.logger.warn(message),
  });
  ctx.effect(() => () => bridge.dispose());
  await bridge.start();
  const source = new CodexTokenSource({ ...config, childEnvironment });
  const enabled = () => (typeof config.enabled?.get === 'function' ? config.enabled.get() : config.enabled) !== false;
  const controller = new AuthController({ source, enabled, beforeAuth: () => bridge.ensure(), childEnvironment });
  ctx.effect(() => () => controller.dispose());
  const handle = authRpcHandler(controller);
  // Exact /api routes inherit Harness's authenticated Host/Origin boundary and
  // also work through the desktop's in-process Fetch carrier.
  for (const endpoint of ['state', 'refresh', 'quota', 'login', 'cancel']) {
    ctx.connection.fetch.register({
      path: `/api/codex-auth/${endpoint}`, methods: ['POST'], requestBody: 'buffered',
      fetch: async request => {
        let parsed;
        try { parsed = clientRequestSchema.safeParse(await request.json()); } catch { return new Response('invalid request', { status: 400 }); }
        if (!parsed.success || parsed.data.method !== `codex-auth/${endpoint}`) return new Response('invalid request', { status: 400 });
        return Response.json({ type: 'server-response', rpcId: parsed.data.rpcId, result: await handle(endpoint, parsed.data.payload) });
      },
    });
  }
  ctx.llm.registerAdapter([PROVIDER], createCodexAdapter(ctx, config, source, async () => {
    if (!enabled()) throw new LlmError('Codex 连接已停用，请在设置 → OpenAI / Codex 中启用。', 'CODEX_CONNECTION_DISABLED');
    await bridge.ensure();
  }));
  ctx.logger.info('Codex subscription provider is available. Authentication remains managed by the local Codex CLI.');
}
