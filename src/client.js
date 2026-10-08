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
    };
    const date = value => value ? new Date(value).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '未知';
    const duration = mins => mins == null ? '额度窗口' : mins >= 1440 ? `${Math.round(mins / 1440)} 天额度` : mins >= 60 ? `${Math.round(mins / 60)} 小时额度` : `${mins} 分钟额度`;

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

      async function call(method) {
        const result = await rpc(method);
        if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
        return result.value;
      }
      function accept(value) {
        if (!active.current) return;
        const identity = value.account?.key ?? null;
        if (previousAccount.current !== identity) { setQuota(null); setQuotaError(null); previousAccount.current = identity; }
        setState(value);
      }
      async function loadQuota() {
        if (active.current) { setBusy('quota'); setQuotaError(null); }
        try { const value = await call('quota'); if (active.current) setQuota(value); }
        catch (err) { if (active.current) { setQuota(null); setQuotaError(errors[err.code] ?? '额度读取失败，请检查网络后重试。'); } }
        finally { if (active.current) setBusy(null); }
      }
      async function sync() { const value = await call('state'); accept(value); return value; }
      React.useEffect(() => {
        active.current = true;
        sync().then(value => { if (value.connected && value.enabled && active.current) loadQuota(); else if (active.current) setBusy(null); }).catch(() => { if (active.current) { setError('无法读取授权状态，请重试或重启 Harness。'); setBusy(null); } });
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

      async function operation(method) {
        setBusy(method); setError(null); setNotice(null);
        if (method === 'login') { setQuota(null); setQuotaError(null); }
        try {
          const value = await call(method); accept(value);
          if (method === 'refresh') setNotice('授权已刷新。');
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
          quota && h('p', { className: 'small muted', style: { marginTop: 14 } }, `更新于 ${date(quota.fetchedAt)} · 与本机 Codex 共享额度`)),
        h('p', { className: 'footer' }, '使用时，在会话模型选择器中选择「OpenAI · Codex 额度」。系统代理切换后需要重启 Harness。'));
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
      },
    };
  },
});
