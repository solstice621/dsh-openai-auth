// Harness native lazy-CJS client entry. React is provided by the desktop shell.
window.__ModuleLoader__.load({
  id: 'dsh-openai-auth',
  factory: require => {
    const React = require('react');
    const h = React.createElement;
    const css = `
.codex-auth{color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6;padding-bottom:16px}
.codex-auth h2{font-size:22px;font-weight:600;letter-spacing:-.4px;margin:0 0 4px}.codex-auth h3{font-size:14px;font-weight:600;margin:0}
.codex-auth p{margin:6px 0}.codex-auth .muted{color:var(--dsw-alias-label-secondary)}
.codex-auth .card{border:1px solid var(--dsw-alias-border-medium,rgba(128,128,128,.2));border-radius:12px;padding:18px;margin-top:20px;background:var(--dsw-alias-bg-layer-1,transparent)}
.codex-auth .row{display:flex;align-items:center;justify-content:space-between;gap:12px}.codex-auth .badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap;padding:3px 9px;border-radius:999px;background:rgba(40,167,110,.1);color:#239c68}.codex-auth .badge.off{background:rgba(128,128,128,.12);color:var(--dsw-alias-label-secondary)}
.codex-auth .dot{width:6px;height:6px;border-radius:50%;background:currentColor}.codex-auth .account{font-size:17px;font-weight:500;word-break:break-all;margin:14px 0 2px}
.codex-auth .buttons{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.codex-auth button,.codex-auth a.action{font:inherit;font-size:13px;font-weight:500;border:1px solid var(--dsw-alias-border-medium,rgba(128,128,128,.25));border-radius:8px;padding:7px 12px;color:inherit;background:transparent;cursor:pointer;text-decoration:none;line-height:20px}
.codex-auth button:hover,.codex-auth a.action:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1))}.codex-auth button.primary,.codex-auth a.primary{background:#4d6bfe;border-color:#4d6bfe;color:white}.codex-auth button:disabled{opacity:.45;cursor:default}.codex-auth button:focus-visible,.codex-auth a:focus-visible{outline:2px solid #4d6bfe;outline-offset:3px}
.codex-auth .small{font-size:12px}.codex-auth .quota-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:14px}.codex-auth .quota-name{font-size:12px;margin-bottom:5px}.codex-auth .percent{font-size:23px;font-weight:600;line-height:1.3}.codex-auth .track{background:rgba(128,128,128,.15);height:5px;border-radius:8px;margin:10px 0;overflow:hidden}.codex-auth .fill{height:100%;background:#4d6bfe;border-radius:8px}.codex-auth .notice{padding:12px 14px;border-radius:8px;background:rgba(77,107,254,.08);margin-top:14px}.codex-auth .error{background:rgba(219,84,84,.09);color:var(--dsw-alias-label-primary)}
.codex-auth .text-button{border:0;padding:0;color:#4d6bfe;background:none}.codex-auth .bucket+.bucket{border-top:1px solid rgba(128,128,128,.15);padding-top:14px;margin-top:14px}.codex-auth .footer{margin-top:20px;font-size:12px;color:var(--dsw-alias-label-secondary)}
@media(max-width:650px){.codex-auth .quota-grid{grid-template-columns:1fr}.codex-auth .row{align-items:flex-start}}
.codex-auth .model-search{box-sizing:border-box;width:100%;margin-top:14px;padding:8px 10px;border:1px solid var(--dsw-alias-border-medium,rgba(128,128,128,.25));border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:13px}
.codex-auth .model-list{max-height:280px;overflow-y:auto;margin-top:10px}.codex-auth .model-option{display:flex;align-items:center;gap:10px;padding:9px 8px;border-radius:8px;cursor:pointer}.codex-auth .model-option:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1))}.codex-auth .model-option:has(input:disabled){opacity:.6;cursor:default}
.codex-auth .model-option input{width:16px;height:16px;margin:0;flex-shrink:0;accent-color:#4d6bfe}.codex-auth .model-label{display:flex;flex-direction:column;min-width:0}.codex-auth .model-id{overflow-wrap:anywhere}.codex-auth .model-list input:focus-visible,.codex-auth .model-search:focus-visible{outline:2px solid #4d6bfe;outline-offset:2px}
@media(prefers-reduced-motion:no-preference){.codex-auth .fill{transition:width .2s ease}}
`;
    const errors = {
      CODEX_AUTH_REQUIRED: '还没有可用的 Codex / ChatGPT 登录。点击「登录 ChatGPT」连接账号。',
      CODEX_TOKEN_EXPIRED: '授权已过期，刷新授权后即可继续使用。',
      CODEX_CLI_UNAVAILABLE: '无法启动本机 Codex。请检查插件配置里的 Codex 可执行文件路径。',
      SYSTEM_PROXY_CHANGED: '系统代理已切换，请重启 Harness 后继续。',
      CODEX_RPC_TIMEOUT: '请求超时，请检查当前网络和代理后重试。',
      CODEX_ACCOUNT_CHANGED: '账号已变化，请重新读取额度。',
      CODEX_LOGIN_FAILED: '登录未完成，请重试。',
      CODEX_SERVER_EXITED: 'Codex 连接中断，请重试。',
      CODEX_MODEL_SYNC_FAILED: '模型同步失败，已保留当前目录。请检查 Codex 版本和网络后重试。',
      CODEX_CONNECTION_DISABLED: '请先启用 Codex 连接，再刷新模型。',
    };
    const date = value => value ? new Date(value).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '未知';
    const duration = mins => mins == null ? '额度窗口' : mins >= 1440 ? `${Math.round(mins / 1440)} 天额度` : mins >= 60 ? `${Math.round(mins / 60)} 小时额度` : `${mins} 分钟额度`;

    function ModelSelection({ models = [], form, formState }) {
      const [query, setQuery] = React.useState('');
      const [saving, setSaving] = React.useState(false);
      const [message, setMessage] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [pendingIds, setPendingIds] = React.useState(undefined);
      const pending = React.useRef(false);
      const active = React.useRef(true);
      React.useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
      const savedIds = formState.value?.selectedModelIds ?? null;
      const ids = pendingIds === undefined ? savedIds : pendingIds;
      const selected = ids === null ? null : new Set(ids);
      const readyModels = models.filter(model => !model.limitsPending);
      const count = readyModels.filter(model => selected === null || selected.has(model.id)).length;
      const needle = query.trim().toLowerCase();
      const matches = models.filter(model => (model.name + ' ' + model.id).toLowerCase().includes(needle));
      const locked = saving || !formState.writable || !models.length;

      async function save(next) {
        if (pending.current) return;
        pending.current = true;
        setPendingIds(next);
        setSaving(true); setError(null); setMessage(null);
        try {
          if (!await form.set('selectedModelIds', next)) throw Error('settings write failed');
          if (active.current) setMessage('已保存，会话模型列表已更新。');
        } catch {
          if (active.current) setError('模型选择未保存，请重试。');
        } finally {
          pending.current = false;
          if (active.current) { setPendingIds(undefined); setSaving(false); }
        }
      }
      function toggle(id, checked) {
        const next = new Set(ids ?? readyModels.map(model => model.id));
        if (checked) next.add(id); else next.delete(id);
        save([...next]);
      }

      return h('div', { className: 'card', 'aria-busy': saving },
        h('div', { className: 'row' }, h('h3', null, '模型显示'), h('span', { className: 'small muted', role: 'status' }, '已选 ' + count + ' / ' + readyModels.length + ' 个可用模型')),
        h('p', { className: 'small muted', style: { marginTop: 12 } }, '会话中可选用已勾选且限额已确认的模型。'),
        h('p', { className: 'small muted' }, ids === null ? '默认显示全部可用模型，包括之后同步到的新模型。' : '之后同步到的新模型需手动勾选。'),
        h('div', { className: 'buttons' },
          h('button', { type: 'button', disabled: locked || !readyModels.length, onClick: () => save([...new Set([...(ids ?? []), ...readyModels.map(model => model.id)])]) }, '全选'),
          h('button', { type: 'button', disabled: locked || ids?.length === 0, onClick: () => save([]) }, '全不选'),
          h('button', { type: 'button', disabled: locked || ids === null, onClick: () => save(null) }, '恢复默认')),
        h('input', { type: 'search', className: 'model-search', placeholder: '搜索模型名称或 ID…', 'aria-label': '搜索可显示的模型', value: query, onChange: event => setQuery(event.target.value) }),
        h('div', { className: 'model-list', role: 'group', 'aria-label': '会话中显示的模型' },
          matches.map(model => h('label', { className: 'model-option', key: model.id },
            h('input', { type: 'checkbox', checked: selected?.has(model.id) ?? !model.limitsPending, disabled: locked || Boolean(model.limitsPending), onChange: event => toggle(model.id, event.target.checked) }),
            h('span', { className: 'model-label' }, h('span', null, model.name),
              h('span', { className: 'small muted model-id' }, model.id),
              model.limitsPending && h('span', { className: 'small muted' }, '限额待同步')))),
          !matches.length && h('p', { className: 'small muted' }, models.length ? '没有匹配的模型。' : '正在读取模型目录…')),
        ids !== null && count === 0 && readyModels.length > 0 && h('p', { className: 'small muted' }, '已隐藏当前可用的全部模型，可随时重新勾选。'),
        !formState.writable && h('p', { className: 'small muted' }, '当前设置暂不可写，请稍后重试。'),
        saving && h('p', { className: 'small muted', role: 'status' }, '正在保存模型选择…'),
        message && h('p', { className: 'small muted', role: 'status' }, message),
        error && h('p', { className: 'notice error', role: 'alert' }, error));
    }

    function QuotaWindow({ value }) {
      if (!value) return h('div', null, h('p', { className: 'muted' }, '该窗口数据暂不可用'));
      const remaining = 100 - value.usedPercent;
      return h('div', null,
        h('div', { className: 'quota-name muted' }, duration(value.durationMins)),
        h('div', { className: 'percent' }, `${remaining}%`, h('span', { className: 'small muted', style: { marginLeft: 6, fontWeight: 400 } }, '剩余')),
        h('div', { className: 'track', role: 'progressbar', 'aria-label': duration(value.durationMins) + '剩余额度', 'aria-valuenow': remaining, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('div', { className: 'fill', style: { width: `${remaining}%`, background: remaining < 10 ? '#d9853b' : undefined } })),
        h('div', { className: 'small muted' }, `重置时间：${date(value.resetsAt)}`));
    }

    function AuthPage({ rpc, form }) {
      const [state, setState] = React.useState(null);
      const [quota, setQuota] = React.useState(null);
      const [busy, setBusy] = React.useState('state');
      const [error, setError] = React.useState(null);
      const [notice, setNotice] = React.useState(null);
      const [quotaError, setQuotaError] = React.useState(null);
      const [hideAccount, setHideAccount] = React.useState(false);
      const formState = React.useSyncExternalStore(listener => form.subscribe(listener), () => form.getSnapshot());
      const enabled = formState.value?.enabled ?? state?.enabled ?? true;
      const active = React.useRef(true);
      const previousAccount = React.useRef(null);
      const latestQuota = React.useRef(null);

      async function call(method) {
        const result = await rpc(method);
        if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
        return result.value;
      }
      function accept(value) {
        if (!active.current) return;
        const identity = value.account?.key ?? null;
        if (previousAccount.current !== identity) { latestQuota.current = null; setQuota(null); setQuotaError(null); previousAccount.current = identity; }
        setState(value);
      }
      function acceptQuota(value, identity) {
        if (!active.current || previousAccount.current !== identity || !value?.buckets?.length || (value.identity && value.identity !== identity)) return false;
        // A late cache reply must not replace a newer manual refresh or another
        // account's display. Equal timestamps keep the existing live reading.
        if (latestQuota.current && value.fetchedAt <= latestQuota.current.fetchedAt) return true;
        latestQuota.current = value; setQuota(value); setQuotaError(null);
        return true;
      }
      async function loadQuota() {
        const identity = previousAccount.current;
        if (active.current) { setBusy('quota'); setQuotaError(null); }
        // A cached reading stays on screen while the refresh runs; only a failure
        // with nothing to show falls back to the placeholder text.
        try { acceptQuota(await call('quota'), identity); }
        catch (err) { if (active.current && previousAccount.current === identity) setQuotaError(errors[err.code] ?? '额度读取失败，请检查网络后重试。'); }
        finally { if (active.current) setBusy(null); }
      }
      // Paint the previous reading first, then refresh it behind the user.
      async function showCachedQuota() {
        const identity = previousAccount.current;
        try { return acceptQuota(await call('cached'), identity); }
        catch { return false; }
      }
      async function sync() { const value = await call('state'); accept(value); return value; }
      React.useEffect(() => {
        active.current = true;
        sync().then(async value => {
          if (!active.current) return;
          if (!value.connected || !value.enabled) { setBusy(null); return; }
          const painted = await showCachedQuota();
          if (!active.current) return;
          if (!painted) setBusy('quota');
          await loadQuota();
        }).catch(() => { if (active.current) { setError('无法读取授权状态，请重试或重启 Harness。'); setBusy(null); } });
        const focus = () => { sync().catch(() => {}); };
        window.addEventListener('focus', focus);
        return () => { active.current = false; window.removeEventListener('focus', focus); };
      }, []);
      React.useEffect(() => {
        if (state?.attempt?.phase !== 'waiting-browser') return;
        let running = false;
        const timer = window.setInterval(async () => {
          if (running) return;
          running = true;
          try { const next = await sync(); if (next.attempt?.phase === 'succeeded') { setNotice('登录成功，账号已连接。'); loadQuota(); } }
          catch { /* a subsequent poll/focus handles transient reconnection */ }
          finally { running = false; }
        }, 1500);
        return () => window.clearInterval(timer);
      }, [state?.attempt?.phase]);
      React.useEffect(() => {
        if (!state?.models) return;
        // Poll only local display state. This does not trigger a catalog request
        // unless the login identity changed; network discovery has its own TTL.
        const timer = window.setInterval(() => { sync().catch(() => {}); }, state.models.refreshing ? 1500 : 30000);
        return () => window.clearInterval(timer);
      }, [state?.models?.refreshing]);
      React.useEffect(() => {
        if (!enabled || !state?.connected || !state?.account?.key) return;
        let running = false, cancelled = false;
        const identity = state.account.key;
        // This is a disk-only RPC. Network polling continues in the backend
        // even after this page unmounts, and does not depend on this timer.
        const timer = window.setInterval(async () => {
          if (running || cancelled) return;
          running = true;
          try { const value = await call('cached'); if (!cancelled) acceptQuota(value, identity); }
          catch { /* preserve the current quota on local/RPC errors */ }
          finally { running = false; }
        }, 30000);
        return () => { cancelled = true; window.clearInterval(timer); };
      }, [enabled, state?.connected, state?.account?.key]);

      async function operation(method) {
        setBusy(method); setError(null); setNotice(null);
        if (method === 'login') { latestQuota.current = null; setQuota(null); setQuotaError(null); }
        try {
          const value = await call(method); accept(value);
          if (method === 'refresh') setNotice('授权已刷新。');
          if (method === 'models') setNotice(`模型列表已同步，${value.models?.totalModels ?? 0} 个可用${value.models?.pendingCount ? `，${value.models.pendingCount} 个限额待同步` : ''}。`);
          if (method === 'cancel') setNotice('已取消本次登录。');
          if (method === 'login' && value.attempt?.authUrl) window.open(value.attempt.authUrl, '_blank', 'noopener,noreferrer');
        } catch (err) { setError(errors[err.code] ?? '操作未完成，请检查网络后重试。'); }
        finally { if (active.current) setBusy(null); }
      }
      async function toggle() {
        setBusy('toggle'); setError(null); setNotice(null);
        try {
          const target = !enabled;
          const accepted = await form.set('enabled', target);
          if (!accepted) throw Error('settings write failed');
          setNotice(target ? 'Codex 连接已启用。' : '已停用 Harness 的 Codex 连接。');
          await sync();
        } catch { setError('设置未保存，请重新打开此页面后重试。'); }
        finally { if (active.current) setBusy(null); }
      }
      const waiting = state?.attempt?.phase === 'waiting-browser';
      const status = !state ? (busy === 'state' ? '读取中' : '未能读取') : !enabled ? '已停用' : waiting ? '等待登录' : state.connected ? '已连接' : '需要登录';
      const locked = Boolean(busy);
      return h('div', { className: 'codex-auth', 'aria-busy': locked },
        h('h2', null, 'OpenAI / Codex'),
        h('p', { className: 'muted' }, '在 Harness 使用你的 ChatGPT 登录和 Codex 订阅额度。'),
        h('div', { className: 'card' },
          h('div', { className: 'row' }, h('h3', null, '账号连接'), h('span', { className: 'badge' + (enabled && state?.connected ? '' : ' off'), role: 'status' }, h('span', { className: 'dot' }), status)),
          h('div', { className: 'row', style: { marginTop: 14 } },
            h('div', { className: 'account', style: { marginTop: 0 } }, hideAccount && state?.account ? 'ChatGPT 账号（已隐藏）' : state?.account?.email || (state?.account ? 'ChatGPT 账号' : '尚未连接账号')),
            state?.account && h('button', { className: 'text-button small', onClick: () => setHideAccount(value => !value), 'aria-pressed': hideAccount }, hideAccount ? '显示账号' : '隐藏账号')),
          state?.account && h('p', { className: 'muted small' }, [state.account.plan ? `ChatGPT ${state.account.plan}` : 'ChatGPT 订阅', `授权有效至 ${date(state.expiresAt)}`].join(' · ')),
          state?.error && h('p', { className: 'small muted' }, errors[state.error] ?? '当前授权不可用，请重新登录。'),
          h('div', { className: 'buttons' },
            h('button', { className: state?.connected ? '' : 'primary', disabled: locked || waiting, onClick: () => operation('login') }, busy === 'login' ? '正在启动登录…' : state?.account ? '重新登录 ChatGPT' : '登录 ChatGPT'),
            state?.account && h('button', { disabled: locked || waiting, onClick: () => operation('refresh') }, busy === 'refresh' ? '正在刷新…' : '刷新授权'),
            h('button', { disabled: locked || !formState.writable || waiting, onClick: toggle }, busy === 'toggle' ? '正在保存…' : enabled ? '停用此连接' : '启用此连接'),
            !state && h('button', { disabled: locked, onClick: async () => { setBusy('state'); setError(null); try { await sync(); } catch { setError('无法读取授权状态，请重启 Harness 后重试。'); } finally { setBusy(null); } } }, '重新读取状态')),
          h('p', { className: 'small muted', style: { marginTop: 12 } }, '登录与本机 Codex 共用；重新登录会切换 Codex 的账号。停用只影响 Harness，不会退出 Codex。'),
          waiting && h('div', { className: 'notice', role: 'status' },
            h('p', null, '请在浏览器完成 ChatGPT 登录，完成后这里会自动更新。'),
            h('div', { className: 'buttons' }, h('a', { className: 'action primary', href: state.attempt.authUrl, target: '_blank', rel: 'noopener noreferrer' }, '打开登录页面'), h('button', { disabled: locked, onClick: () => operation('cancel') }, '取消登录'))),
          state?.attempt?.phase === 'failed' && h('p', { className: 'notice error', role: 'alert' }, errors[state.attempt.error] ?? '登录失败，请重试。'),
          state?.attempt?.phase === 'expired' && h('p', { className: 'notice error', role: 'alert' }, '登录等待已超时，请重新发起。')),
        error && h('p', { className: 'notice error', role: 'alert' }, error),
        notice && h('p', { className: 'notice', role: 'status' }, notice),
        h('div', { className: 'card' },
          h('div', { className: 'row' }, h('h3', null, '订阅额度'), h('button', { className: 'text-button', disabled: locked || !state?.connected || waiting, onClick: loadQuota }, busy === 'quota' ? '读取中…' : '刷新额度')),
          quota?.buckets?.length ? quota.buckets.map(bucket => h('div', { className: 'bucket', key: bucket.id },
            quota.buckets.length > 1 && h('p', { className: 'small muted' }, bucket.name),
            h('div', { className: 'quota-grid' }, h(QuotaWindow, { value: bucket.primary }), h(QuotaWindow, { value: bucket.secondary })))) : h('p', { className: 'muted', style: { marginTop: 14 } }, busy === 'quota' ? '正在读取 OpenAI 额度…' : quotaError ?? '连接账号后可读取额度。'),
          quota?.buckets?.length && quotaError && h('p', { className: 'small muted', style: { marginTop: 10 }, role: 'alert' }, quotaError),
          quota && h('p', { className: 'small muted', style: { marginTop: 14 } },
            `${quota.cached ? '上次更新' : '更新于'} ${date(quota.fetchedAt)} · 与本机 Codex 共享额度`,
            quota.cached && busy === 'quota' ? ' · 正在刷新…' : '',
            enabled ? ` · 后台每 ${state?.quotaRefreshMinutes ?? 5} 分钟自动刷新` : ' · 后台刷新已暂停')),
        state?.showModelSync !== false && h('div', { className: 'card' },
          h('div', { className: 'row' }, h('h3', null, '模型自动同步'), h('button', { className: 'text-button', disabled: locked || !enabled || !state?.connected || waiting || state?.models?.refreshing, onClick: () => operation('models') }, busy === 'models' || state?.models?.refreshing ? '同步中…' : '刷新模型')),
          h('p', { className: 'muted small', style: { marginTop: 14 } }, !enabled ? '连接已停用，自动同步已暂停。' : `启动时同步，每 ${state?.models?.intervalMinutes ?? 360} 分钟自动刷新；账号变化后重新同步。`),
          state?.models && h('p', { className: 'small muted', style: { marginTop: 8 } }, `当前 ${state.models.totalModels} 个模型 · ${state.models.source === 'codex' ? '官方 Codex 目录' : state.models.source === 'cache' ? '最近成功的缓存' : '内置备用目录'} · 最近同步：${date(state.models.lastSyncAt)}`),
          state?.models?.error && h('p', { className: 'small muted' }, errors[state.models.error] ?? '同步未完成，当前模型目录仍可使用。'),
          state?.models?.contextReadFailed && h('p', { className: 'small muted' }, '上下文限额刷新失败，已保留可用限额。可点击「刷新模型」重试。'),
          Boolean(state?.models?.pendingCount) && h('p', { className: 'small muted' }, `${state.models.pendingCount} 个模型限额待同步，确认后可在会话中选用。`),
          state?.models?.cacheSaved === false && h('p', { className: 'small muted' }, '模型目录已更新，但缓存未保存；重启后会重新同步。'),
          h('p', { className: 'small muted', style: { marginTop: 8 } }, '目录取决于 Codex 客户端和账号。新模型沿用当前 Responses 协议；新协议仍需升级插件。')),
        h(ModelSelection, { models: state?.models?.availableModels, form, formState }),
        h('p', { className: 'footer' }, '使用时，在会话模型选择器中选择「OpenAI · Codex 额度」。系统代理切换后需要重启 Harness。'));
    }

    // This plugin owns its account quota UI and reads only its own RPC endpoints.
    function registerComposerQuota(ctx) {
      ctx.inject(['modelDirectories'], scope => {
        const { createPortal } = require('react-dom');
        const stamp = time => new Date(time).toLocaleString();
        const quotaCss = `
.dsh-openai-plan-pill{display:inline-flex;align-items:center;flex-wrap:wrap;gap:2px 7px;max-width:100%;min-width:0;border:0;border-radius:7px;padding:3px 7px;background:transparent;color:var(--dsw-alias-label-secondary,#737373);font:inherit;font-size:12px;line-height:20px;cursor:pointer;font-variant-numeric:tabular-nums;text-align:left}
.dsh-openai-plan-pill:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1));color:var(--dsw-alias-label-primary)}
.dsh-openai-plan-pill:focus-visible,.dsh-openai-plan-dialog button:focus-visible{outline:2px solid #4d6bfe;outline-offset:2px}
.dsh-openai-plan-window{white-space:nowrap}.dsh-openai-plan-low{color:#c46d25}.dsh-openai-plan-separator{color:var(--dsw-alias-label-tertiary,#858585)}
[data-composer-dock]:has([data-auth-plan-usage="dsh-openai-auth"]){flex-wrap:wrap}
.dsh-openai-plan-backdrop{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;padding:20px}
.dsh-openai-plan-dialog{box-sizing:border-box;max-width:600px;width:100%;max-height:85vh;overflow:auto;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#262626);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.2));border-radius:16px;box-shadow:0 16px 60px #0003;padding:24px;font-size:13px;line-height:1.6}
.dsh-openai-plan-dialog h2{font-size:18px;margin:0;font-weight:600}.dsh-openai-plan-dialog p{margin:10px 0}.dsh-openai-plan-dialog .plan-muted{color:var(--dsw-alias-label-secondary,#737373)}.dsh-openai-plan-dialog .plan-small{font-size:12px}
.dsh-openai-plan-dialog .plan-row{display:flex;justify-content:space-between;align-items:center;gap:12px}.dsh-openai-plan-dialog .dsh-openai-plan-row{padding-top:14px;margin-top:14px;border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.16))}
.dsh-openai-plan-dialog button{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.2));border-radius:8px;padding:5px 10px;background:transparent;color:inherit;font:inherit;cursor:pointer}.dsh-openai-plan-dialog button:disabled{opacity:.5;cursor:wait}.dsh-openai-plan-dialog .plan-notice{background:rgba(77,107,254,.07);border-radius:8px;padding:10px 12px;margin-top:12px}
.dsh-openai-plan-track{height:4px;margin:8px 0;border-radius:4px;background:rgba(128,128,128,.15);overflow:hidden}.dsh-openai-plan-track>span{display:block;height:100%;background:#4d6bfe;border-radius:4px}
@media(max-width:560px){.dsh-openai-plan-backdrop{padding:12px}.dsh-openai-plan-dialog{padding:18px}.dsh-openai-plan-pill{font-size:11px;padding-inline:4px;gap:2px 5px}}`;
        const composerSource = {"label": "Codex", "prefix": "codex-auth", "kind": "codex"};
        const composerProviders = new Set(["codex-subscription", "openai-codex"]);
    const percent = value => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value) + '%';
    function duration(mins, fallback) {
      if (!Number.isFinite(mins) || mins <= 0) return fallback;
      if (mins % 10080 === 0) return mins === 10080 ? 'Week' : mins / 10080 + 'w';
      if (mins % 1440 === 0) return mins / 1440 + 'd';
      if (mins % 60 === 0) return mins / 60 + 'h';
      return mins + 'm';
    }
    function windowName(value, index) {
      if (Number.isFinite(value.durationMins)) return duration(value.durationMins, value.id);
      const labels = { weekly: 'Week', monthly: 'Month', daily: 'Day' };
      if (labels[value.id]) return labels[value.id];
      const name = value.nameEn || value.name || value.id || 'Window ' + (index + 1);
      const hours = name.match(/(\d+(?:\.\d+)?)\s*[- ]?\s*(?:hours?|小时)/i);
      return hours ? hours[1] + 'h' : name.replace(/额度$/, '').trim();
    }
    function quotaWindows(source, quota) {
      const remaining = value => Number.isFinite(value) ? Math.max(0, Math.min(100, 100 - value)) : null;
      if (source.kind === 'opencode') return (quota?.windows ?? []).map((value, i) => ({
        id: value.id ?? String(i),
        name: windowName(value, i),
        remaining: remaining(value.usedPercent), resetsAt: value.resetsAt,
      }));
      // Preserve every returned bucket and every non-null window within it.
      return (quota?.buckets ?? []).flatMap((bucket, i, buckets) => Object.entries(bucket)
        .filter(([, value]) => value && typeof value === 'object' &&
          ('usedPercent' in value || 'durationMins' in value || 'resetsAt' in value))
        .map(([key, value]) => ({
          id: (bucket.id ?? i) + '/' + key,
          name: (buckets.length > 1 ? (bucket.name || bucket.id || '额度 ' + (i + 1)) + ' · ' : '') + duration(value.durationMins, key),
          remaining: remaining(value.usedPercent), resetsAt: value.resetsAt,
        })));
    }
    function createPlanStore(source, rpc) {
      const empty = () => ({ status: source.prefix ? 'loading' : 'unavailable', quota: null, error: null, busy: false });
      let snapshot = empty(), identity = null, epoch = 0, pending = null, timer, disposed = false;
      let lastAttempt = -Infinity;
      const listeners = new Set();
      const keyOf = state => source.kind === 'codex' ? state?.account?.key : state?.credential?.id;
      const quotaKey = quota => source.kind === 'codex' ? quota?.identity : quota?.credentialId;
      function publish(value) { snapshot = { ...snapshot, ...value }; for (const fn of listeners) fn(); }
      async function call(method) {
        const result = await rpc(source.prefix, method);
        if (!result?.ok) throw Error('quota-unavailable');
        return result.value;
      }
      function load(force = false) {
        if (disposed || !listeners.size || !source.prefix || (document.hidden && !force)) return Promise.resolve();
        if (pending) return pending.promise;
        const job = { epoch, force };
        const valid = () => !disposed && listeners.size > 0 && epoch === job.epoch;
        pending = job;
        job.promise = (async () => {
          try {
            const state = await call('state');
            if (!valid()) return;
            const nextIdentity = keyOf(state) ?? null;
            if (nextIdentity !== identity) {
              identity = nextIdentity; lastAttempt = -Infinity;
              publish({ ...empty(), busy: force });
            }
            if (!state.enabled || !state.connected || !identity) {
              publish({ status: !state.enabled ? 'disabled' : 'disconnected', quota: null, error: null, busy: false });
              return;
            }
            if (force) publish({ busy: true, error: null });
            let quota = await call('cached');
            if (!valid()) return;
            if (quota && quotaKey(quota) !== identity) {
              publish({ status: 'loading', quota: null, busy: false, error: '账号正在切换，等待更新。' });
              return;
            }
            if (quota && (!snapshot.quota || quota.fetchedAt >= snapshot.quota.fetchedAt)) {
              publish({ status: 'ready', quota, error: null });
            }
            // The auth plugins already refresh in the backend. Only a missing
            // cache or an explicit user refresh needs an upstream quota read.
            if (force || (!quota && Date.now() - lastAttempt >= 300000)) {
              lastAttempt = Date.now(); publish({ busy: true });
              quota = await call('quota');
              if (!valid()) return;
              if (quotaKey(quota) !== identity) {
                publish({ status: 'loading', quota: null, busy: false, error: '账号正在切换，等待更新。' });
                return;
              }
              if (!snapshot.quota || quota.fetchedAt >= snapshot.quota.fetchedAt) publish({ status: 'ready', quota, error: null });
            }
            if (!valid()) return;
            publish({ status: snapshot.quota ? 'ready' : 'unavailable', busy: false });
          } catch {
            if (valid()) publish({ status: snapshot.quota ? 'ready' : 'error', busy: false, error: '额度暂时无法读取，请稍后重试。' });
          }
        })().finally(() => { if (pending === job) pending = null; });
        return job.promise;
      }
      const visible = () => { if (!document.hidden) void load(); };
      function stop() {
        epoch++; clearInterval(timer); timer = null; pending = null;
        document.removeEventListener('visibilitychange', visible);
        snapshot = empty(); identity = null; lastAttempt = -Infinity;
      }
      return {
        getSnapshot: () => snapshot,
        subscribe(fn) {
          if (disposed) return () => {};
          listeners.add(fn);
          if (listeners.size === 1 && source.prefix) {
            void load(); timer = setInterval(visible, 30000);
            document.addEventListener('visibilitychange', visible);
          }
          return () => { listeners.delete(fn); if (!listeners.size) stop(); };
        },
        async refresh() {
          if (pending && !pending.force) await pending.promise;
          return load(true);
        },
        dispose() { disposed = true; stop(); listeners.clear(); },
      };
    }
    function useDialogFocus(close) {
      const ref = React.useRef(null);
      React.useEffect(() => {
        const previous = document.activeElement;
        const root = ref.current;
        root?.querySelector('button')?.focus();
        const onKey = event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
          if (event.key === 'Tab') {
            const targets = [...root.querySelectorAll('button:not(:disabled),a[href]')];
            const first = targets[0], last = targets[targets.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        };
        document.addEventListener('keydown', onKey, true);
        return () => { document.removeEventListener('keydown', onKey, true); previous?.focus?.(); };
      }, []);
      return ref;
    }
    function PlanDialog({ source, data, windows, close, refresh }) {
      const ref = useDialogFocus(close);
      return createPortal(h('div', { className: 'dsh-openai-plan-backdrop', onClick: event => { if (event.target === event.currentTarget) close(); } },
        h('div', { ref, className: 'dsh-openai-plan-dialog', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'dsh-openai-plan-title' },
          h('div', { className: 'plan-row' }, h('h2', { id: 'dsh-openai-plan-title' }, source.label + ' 套餐额度'), h('button', { onClick: close, 'aria-label': '关闭套餐额度' }, '关闭')),
          windows.length ? windows.map(value => h('div', { className: 'dsh-openai-plan-row', key: value.id },
            h('div', { className: 'plan-row' }, h('strong', null, value.name), h('strong', null, value.remaining === null ? '暂无数据' : percent(value.remaining))),
            value.remaining !== null && h('div', { className: 'dsh-openai-plan-track', role: 'progressbar', 'aria-label': value.name + '可用比例', 'aria-valuenow': value.remaining, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('span', { style: { width: value.remaining + '%', background: value.remaining <= 10 ? '#c46d25' : undefined } })),
            h('div', { className: 'plan-muted plan-small' }, '重置时间：' + (Number.isFinite(value.resetsAt) ? stamp(value.resetsAt) : '暂无数据')))) : h('p', { className: 'plan-muted' }, statusText(data)),
          h('p', { className: 'plan-muted plan-small' }, '当前已连接的 ' + source.label + ' 账号 · 百分比表示可用比例'),
          data.quota && h('p', { className: 'plan-muted plan-small' }, '上次更新：' + stamp(data.quota.fetchedAt)),
          data.quota && staleQuota(data.quota, windows) && h('p', { className: 'plan-muted plan-small' }, '当前为上次记录，等待额度刷新。'),
          data.error && h('p', { className: 'plan-notice', role: 'status' }, data.error),
          source.prefix && h('div', { className: 'plan-row', style: { marginTop: 16 } },
            h('span', { className: 'plan-muted plan-small' }, '显示当前套餐返回的全部窗口'),
            h('button', { onClick: refresh, disabled: data.busy || data.status === 'disabled' || data.status === 'disconnected' }, data.busy ? '刷新中…' : '刷新额度')))), document.body);
    }
    function statusText(data) {
      return ({ loading: '额度读取中…', disabled: '连接已停用', disconnected: '需要登录', unavailable: '额度暂不可用', error: '额度读取失败' })[data.status] || '额度暂不可用';
    }
    function staleQuota(quota, windows) {
      return Date.now() - quota.fetchedAt > 600000 || windows.some(value => Number.isFinite(value.resetsAt) && value.resetsAt <= Date.now());
    }
    function PlanPill({ source, store }) {
      const data = React.useSyncExternalStore(store.subscribe, store.getSnapshot);
      const [open, setOpen] = React.useState(false);
      const windows = quotaWindows(source, data.quota);
      const stale = data.quota && staleQuota(data.quota, windows);
      return h(React.Fragment, null,
        h('button', { type: 'button', className: 'dsh-openai-plan-pill', 'data-composer-stat': 'plan', 'data-auth-plan-usage': 'dsh-openai-auth',
          'aria-label': '查看' + source.label + '套餐额度', 'aria-haspopup': 'dialog', 'aria-expanded': open,
          title: source.label + ' · 当前已连接账号的可用比例 · ' + (data.error || (data.quota ? '上次更新：' + stamp(data.quota.fetchedAt) : statusText(data))), onClick: () => setOpen(true) },
          windows.length ? windows.flatMap((value, i) => [
            i > 0 && h('span', { key: value.id + '-separator', className: 'dsh-openai-plan-separator', 'aria-hidden': true }, '·'),
            h('span', { key: value.id, 'data-plan-window': value.id,
              title: value.name + ' · 重置时间：' + (Number.isFinite(value.resetsAt) ? stamp(value.resetsAt) : '暂无数据'),
              className: 'dsh-openai-plan-window' + (value.remaining !== null && value.remaining <= 10 ? ' dsh-openai-plan-low' : '') },
              value.name + ' ' + (value.remaining === null ? '—' : percent(value.remaining))),
          ]) : h('span', null, source.label + ' · ' + statusText(data)),
          stale && h('span', { className: 'dsh-openai-plan-window' }, '待更新')),
        open && h(PlanDialog, { source, data, windows, close: () => setOpen(false), refresh: () => { void store.refresh(); } }));
    }
    function ComposerQuota(props) {
      const selection = React.useSyncExternalStore(fn => props.directory.subscribe(fn), () => props.directory.getSnapshot().current);
      return selection && composerProviders.has(selection.provider)
        ? h(PlanPill, { source: composerSource, store: props.planStore }) : null;
    }
        const planStore = createPlanStore(composerSource, (prefix, method) => scope.connection.rpc.call('/api', prefix + '/' + method, {}));
        scope.effect(() => {
          const style = document.createElement('style');
          style.dataset.plugin = 'dsh-openai-auth-composer-quota'; style.textContent = quotaCss;
          document.head.appendChild(style); return () => style.remove();
        });
        scope.effect(() => () => planStore.dispose());
        scope.slots.inject('conversation.composer.dock', () => scope.slots.register({
          name: 'conversation.composer.dock', id: 'dsh-openai-auth-quota', order: 2.5,
          inject: sessionId => ({ directory: scope.modelDirectories.directoryFor(sessionId).store, planStore }),
        }, ComposerQuota));
      });
    }

    return {
      inject: ['slots', 'connection', 'configForms'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style');
          style.dataset.plugin = 'dsh-openai-auth'; style.textContent = css; document.head.appendChild(style);
          return () => style.remove();
        });
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'openai-codex', order: 25, label: () => 'OpenAI / Codex',
          inject: () => ({ rpc: method => ctx.connection.rpc.call('/api', 'codex-auth/' + method, {}), form: ctx.configForms.get('dsh-openai-auth') }),
        }, AuthPage));
        registerComposerQuota(ctx);
      },
    };
  },
});
