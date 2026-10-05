import { AlertCircle, Globe, Plus, ShieldQuestion } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExtractViewerDialog } from '@/components/ExtractViewerDialog';
import { Header } from '@/components/Header';
import { PageBar } from '@/components/PageBar';
import { UnifiedChat } from '@/components/chat/UnifiedChat';
import { hasSummary, visibleStartIndex, withMessage } from '@/lib/conversation';
import { conversationFromExtract, extractCurrentPage, ExtractError } from '@/lib/extract';
import { drawerPinnedItem, type DrawerMessage } from '@/lib/drawerMessages';
import { ALL_URLS_PATTERN, getOriginPattern, requestHostPermission } from '@/lib/permissions';
import { openProviderManager } from '@/lib/openOptions';
import { summaryUserPrompt } from '@/lib/prompts';
import {
  conversationsItem,
  currentProviderIdItem,
  persistConversation,
  providersItem,
  settingsItem,
} from '@/lib/storage';
import { useActiveTab } from '@/lib/tabs';
import { ensureOffscreenReady, type TurnMessage } from '@/lib/turnMessages';
import { contentBudgetChars, pageKeyOf } from '@/lib/utils';
import { isVideoPageUrl } from '@/lib/video/pages';
import { DEFAULT_SETTINGS, type AppSettings, type ChatMessage, type Conversation, type Provider } from '@/types';

/** 抽屉模式：应用运行在注入 iframe 中（window.top ≠ window.self） */
const IN_DRAWER = typeof window !== 'undefined' && window.self !== window.top;

export default function App() {
  const tab = useActiveTab();
  const pageKey = tab.url ? pageKeyOf(tab.url) : null;

  // ---- 全局 pin 状态（新标签页自动展开抽屉；抽屉与原生面板共用同一个开关） ----
  const [drawerPinned, setDrawerPinned] = useState(false);
  useEffect(() => {
    // 直接 watch storage：任一页面切换 pin，所有抽屉与原生面板实时同步
    void drawerPinnedItem.getValue().then(setDrawerPinned);
    return drawerPinnedItem.watch(setDrawerPinned);
  }, []);

  /** pin 方案 A：开启固定抽屉需要全域注入权限（新标签页/任意网站自动展开）——
   *  开关点击即用户手势，一次气泡换全局自动展开；拒绝则不开启 */
  const toggleDrawerPin = useCallback(async () => {
    if (!drawerPinned) {
      const granted = await requestHostPermission(ALL_URLS_PATTERN);
      if (!granted) {
        setError('开启固定抽屉需要「所有网站」访问权限（用于在新标签页自动展开），请重试并在弹窗中允许');
        return;
      }
    }
    void drawerPinnedItem.setValue(!drawerPinned);
  }, [drawerPinned]);

  const closeDrawer = useCallback(() => {
    window.parent.postMessage({ type: 'websidechat-drawer', action: 'close' }, '*');
  }, []);

  // ---- 配置（storage.watch 联动） ----
  const [providers, setProviders] = useState<Record<string, Provider>>({});
  const [currentProviderId, setCurrentProviderId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    providersItem.getValue().then(setProviders);
    currentProviderIdItem.getValue().then(setCurrentProviderId);
    settingsItem.getValue().then(setSettings);
    const u1 = providersItem.watch(setProviders);
    const u2 = currentProviderIdItem.watch(setCurrentProviderId);
    const u3 = settingsItem.watch(setSettings);
    return () => {
      u1();
      u2();
      u3();
    };
  }, []);

  const providerList = Object.values(providers).sort((a, b) => a.createdAt - b.createdAt);
  const currentProvider = currentProviderId ? (providers[currentProviderId] ?? null) : null;

  // ---- 会话（按 pageKey 加载/切换） ----
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [extracting, setExtracting] = useState(false);
  /** 按 pageKey 隔离的进行中流（值为已生成的流式文本）：多个标签页可并行独立生成 */
  const [streamTexts, setStreamTexts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  /** 提取遇注入权限缺失时待授权的站点（授权按钮点击手势内申请，成功自动重试提取） */
  const [needsPermission, setNeedsPermission] = useState<{ host: string; pattern: string } | null>(
    null,
  );
  useEffect(() => {
    setNeedsPermission(null);
  }, [tab.url]);
  /** 调试模式：查看提取内容弹窗 */
  const [contentViewerOpen, setContentViewerOpen] = useState(false);
  const pageKeyRef = useRef<string | null>(pageKey);

  useEffect(() => {
    pageKeyRef.current = pageKey;
  }, [pageKey]);

  useEffect(() => {
    let cancelled = false;
    conversationsItem.getValue().then((all) => {
      if (cancelled) return;
      setConversation(pageKey ? (all[pageKey] ?? null) : null);
    });
    // 切页/关闭面板都不中断生成：回合引擎在 Offscreen Document 中常驻运行
    return () => {
      cancelled = true;
    };
  }, [pageKey]);

  // ---- 订阅 Offscreen 回合事件（面板只是视图，重开面板也能接上在途流） ----
  useEffect(() => {
    const listener = (msg: TurnMessage) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'turn:delta') {
        setStreamTexts((prev) =>
          msg.pageKey in prev || msg.pageKey === pageKeyRef.current
            ? { ...prev, [msg.pageKey]: msg.full }
            : prev,
        );
      } else if (msg.type === 'turn:done' || msg.type === 'turn:error') {
        console.log('[WebSideChat] 回合结束:', { type: msg.type, pageKey: msg.pageKey, error: msg.type === 'turn:error' ? msg.error : undefined });
        setStreamTexts((prev) => {
          if (!(msg.pageKey in prev)) return prev;
          const next = { ...prev };
          delete next[msg.pageKey];
          return next;
        });
        if (msg.type === 'turn:error' && msg.error) {
          // offscreen 里 LLM 请求失败的诊断日志（offscreen 自身的 console 页面里看不到）
          console.warn('[WebSideChat] 生成失败:', msg.error);
        }
        if (msg.pageKey === pageKeyRef.current) {
          setConversation(msg.conversation);
          if (msg.type === 'turn:error' && msg.error) setError(msg.error);
        }
      }
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  // ---- 核心动作 ----

  /** 发起一轮对话（摘要轮或追问轮）：交给 Offscreen Document 执行并广播进度 */
  const runTurn = useCallback(
    async (target: 'summary' | 'chat', userContent: string, base: Conversation) => {
      const p = currentProvider;
      if (!p) {
        setError('请先在设置中配置并启用一个供应商');
        return;
      }

      // 乐观更新本地视图（引擎侧会以同样规则拼装并落库）
      let optimistic = withMessage(base, { role: 'user', content: userContent } satisfies ChatMessage);
      if (target === 'summary') optimistic = { ...optimistic, summaryPrompt: userContent };
      if (base.pageKey === pageKeyRef.current) setConversation(optimistic);
      setStreamTexts((prev) => ({ ...prev, [base.pageKey]: '' }));
      if (base.pageKey === pageKeyRef.current) setError(null);

      try {
        console.log('[WebSideChat] 发起回合:', { target, pageKey: base.pageKey, provider: p.name, model: p.model });
        await ensureOffscreenReady();
        // 带回执重试：offscreen 文档可能刚创建、脚本尚未注册监听（消息会丢失）
        const start: TurnMessage = {
          type: 'turn:start',
          streamId: crypto.randomUUID(),
          pageKey: base.pageKey,
          provider: p,
          settings,
          conversation: base,
          userContent,
          target,
        };
        let acked = false;
        // 首次使用需从零创建 offscreen（建文档→加载 HTML→解析模块→注册监听），
        // 冷启动可能超过 1 秒：重试预算 6 秒（20 × 300ms），未应答时留诊断日志
        for (let i = 0; i < 20 && !acked; i++) {
          if (i > 0) await new Promise((r) => setTimeout(r, 300));
          acked = (await browser.runtime.sendMessage(start)) === true;
          if (!acked && i > 0 && i % 5 === 0) {
            console.warn(`[WebSideChat] turn:start 第 ${i} 次未应答，offscreen 仍在启动…`);
          }
        }
        if (!acked) {
          console.error('[WebSideChat] turn:start 20 次均未应答，offscreen 启动失败');
          throw new Error('生成引擎未就绪（offscreen 无应答），请重试');
        }
        console.log('[WebSideChat] 回合已被引擎接收，等待流式输出…');
      } catch (err) {
        setStreamTexts((prev) => {
          const next = { ...prev };
          delete next[base.pageKey];
          return next;
        });
        if (base.pageKey === pageKeyRef.current) {
          setError(`发起生成失败：${(err as Error).message}`);
        }
      }
    },
    [currentProvider, settings],
  );

  /** 提取正文 + 开启对话（默认摘要轮；传入 firstUserContent 则首轮直接回答该问题） */
  const extractAndSummarize = useCallback(
    async (firstUserContent?: string) => {
      if (tab.id == null || !tab.url) {
        setError('没有可提取的页面');
        return;
      }
      if (!currentProvider) {
        setError('请先在设置中配置并启用一个供应商');
        return;
      }
      setExtracting(true);
      setError(null);
      try {
        const extract = await extractCurrentPage(tab.id, contentBudgetChars(currentProvider), tab.url);
        const conv = conversationFromExtract({ pageKey: pageKeyOf(tab.url), url: tab.url, extract });
        setConversation(conv);
        await persistConversation(conv);
        setExtracting(false);
        await runTurn(
          firstUserContent ? 'chat' : 'summary',
          firstUserContent ?? summaryUserPrompt(settings, isVideoPageUrl(tab.url)),
          conv,
        );
      } catch (err) {
        setExtracting(false);
        // 注入权限缺失：tabs 权限下 tab.url 可见 → 直接给出站内一键授权（而非仅文字提示）
        if (err instanceof ExtractError && tab.url) {
          const pattern = getOriginPattern(tab.url);
          let host: string | null = null;
          try {
            host = new URL(tab.url).hostname;
          } catch {
            /* ignore */
          }
          if (pattern && host && /无法访问此页面|没有注入权限/.test(err.message)) {
            setError(null);
            setNeedsPermission({ host, pattern });
            return;
          }
        }
        setError(err instanceof ExtractError ? err.message : `提取失败：${String(err)}`);
      }
    },
    [tab.id, tab.url, currentProvider, settings, runTurn],
  );

  /** 已有会话时的重新提取（清空旧摘要与对话，直接执行不弹确认） */
  const reextract = useCallback(() => {
    void extractAndSummarize();
  }, [extractAndSummarize]);

  /** 已有正文时的"生成/重新生成摘要"：重新生成会清空旧摘要与追问 */
  const generateSummaryOnly = useCallback(() => {
    if (!conversation) {
      void extractAndSummarize();
      return;
    }
    // 已有追问时重新生成 = 清空对话，需确认
    if (hasSummary(conversation) && conversation.messages.length > 2) {
      if (!confirm('重新生成摘要将清空后续追问对话，继续？')) return;
    }
    const base = hasSummary(conversation) ? { ...conversation, messages: [] } : conversation;
    void runTurn(
      'summary',
      summaryUserPrompt(settings, isVideoPageUrl(tab.url)),
      base,
    );
  }, [conversation, settings, tab.url, runTurn, extractAndSummarize]);

  const sendQuestion = useCallback(
    (text: string, editFrom?: number) => {
      if (!conversation) {
        // 首次提问：先静默提取正文，再带着问题进入对话
        void extractAndSummarize(text);
        return;
      }
      if (conversation.pageKey in streamTexts) return;
      let base = conversation;
      if (editFrom != null) {
        // 编辑重发（Gemini 交互）：从被编辑的用户消息处截断，保留之前的对话
        const abs = visibleStartIndex(conversation) + editFrom;
        const target = conversation.messages[abs];
        if (target?.role === 'user') {
          base = { ...conversation, messages: conversation.messages.slice(0, abs) };
        }
      }
      void runTurn('chat', text, base);
    },
    [conversation, streamTexts, runTurn, extractAndSummarize],
  );

  /** 停止当前查看页面的流（引擎侧中止，其他页面的后台流不受影响） */
  const stopStreaming = useCallback(() => {
    if (pageKey) {
      void browser.runtime.sendMessage({ type: 'turn:cancel', pageKey } satisfies TurnMessage);
    }
  }, [pageKey]);

  // ---- 渲染 ----

  return (
    <div className="flex h-screen flex-col bg-background">
      <Header
        providers={providerList}
        currentProvider={currentProvider}
        inDrawer={IN_DRAWER}
        drawerPinned={drawerPinned}
        onToggleDrawerPin={toggleDrawerPin}
        onCloseDrawer={closeDrawer}
        onOpenSettings={() => openProviderManager()}
      />
      <PageBar
        url={tab.url}
        title={tab.title}
        conversation={conversation}
        extracting={extracting}
        debug={settings.debugMode ?? true}
        onViewContent={() => setContentViewerOpen(true)}
        onReextract={reextract}
      />

      <ExtractViewerDialog
        conversation={conversation}
        open={contentViewerOpen}
        onOpenChange={setContentViewerOpen}
      />

      {error && (
        <div className="flex items-start gap-1.5 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
          <AlertCircle className="mt-0.5 size-3 shrink-0" />
          <span className="flex-1">{error}</span>
          <button className="shrink-0 underline" onClick={() => setError(null)}>
            关闭
          </button>
        </div>
      )}

      {/* 提取遇注入权限缺失：一键授权本站（永久）并自动重试 */}
      {needsPermission && (
        <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px]">
          <ShieldQuestion className="mt-0.5 size-3 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="font-medium text-amber-800 dark:text-amber-300">
              需要授权访问 {needsPermission.host}
            </p>
            <p className="mt-0.5 text-muted-foreground">
              点一次上方工具栏的扩展图标也可临时授权（当前标签页有效）；或为本站永久授权：
            </p>
            <button
              className="mt-1.5 rounded-full bg-amber-600 px-3 py-1 text-white transition-colors hover:bg-amber-700"
              onClick={() =>
                void (async () => {
                  const granted = await requestHostPermission(needsPermission.pattern);
                  if (granted) {
                    setNeedsPermission(null);
                    void extractAndSummarize();
                  }
                })()
              }
            >
              授权本站（{needsPermission.host}）
            </button>
          </div>
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col">
        {!currentProvider ? (
          <div className="flex flex-col items-center gap-4 px-6 pt-10 text-center">
            <Globe className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">还没有配置 LLM 供应商</p>
            <button
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              onClick={() => openProviderManager({ add: true })}
            >
              <Plus className="size-4" />
              去添加供应商
            </button>
          </div>
        ) : (
          <UnifiedChat
            conversation={conversation}
            videoUrl={tab.url}
            extracting={extracting}
            streaming={conversation != null && conversation.pageKey in streamTexts}
            streamText={conversation ? (streamTexts[conversation.pageKey] ?? '') : ''}
            disabled={!tab.url || (pageKey != null && pageKey in streamTexts) || extracting}
            onPresetSummary={generateSummaryOnly}
            onSend={sendQuestion}
            onStop={stopStreaming}
          />
        )}
      </main>
    </div>
  );
}
