import { AlertCircle, Globe, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExtractViewerDialog } from '@/components/ExtractViewerDialog';
import { Header } from '@/components/Header';
import { PageBar } from '@/components/PageBar';
import { UnifiedChat } from '@/components/chat/UnifiedChat';
import { hasSummary, visibleStartIndex, withMessage } from '@/lib/conversation';
import { conversationFromExtract, extractCurrentPage, ExtractError } from '@/lib/extract';
import type { DrawerMessage } from '@/lib/drawerMessages';
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
import { isYouTubeWatchUrl } from '@/lib/youtube';
import { DEFAULT_SETTINGS, type AppSettings, type ChatMessage, type Conversation, type Provider } from '@/types';

/** 抽屉模式：应用运行在注入 iframe 中（window.top ≠ window.self） */
const IN_DRAWER = typeof window !== 'undefined' && window.self !== window.top;

export default function App() {
  const tab = useActiveTab();
  const pageKey = tab.url ? pageKeyOf(tab.url) : null;

  // ---- 抽屉模式：全局 pin 状态（新标签页自动展开） ----
  const [drawerPinned, setDrawerPinned] = useState(false);
  useEffect(() => {
    if (!IN_DRAWER) return;
    void browser.runtime
      .sendMessage({ type: 'drawer:get-state' } satisfies DrawerMessage)
      .then((state) => {
        const s = state as { pinned?: boolean } | undefined;
        setDrawerPinned(s?.pinned ?? false);
      })
      .catch(() => {});
  }, []);

  const toggleDrawerPin = useCallback(() => {
    const next = !drawerPinned;
    setDrawerPinned(next);
    void browser.runtime
      .sendMessage({ type: 'drawer:set-pinned', pinned: next } satisfies DrawerMessage)
      .catch(() => {});
  }, [drawerPinned]);

  const closeDrawer = useCallback(() => {
    window.parent.postMessage({ type: 'webchat-drawer', action: 'close' }, '*');
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
        setStreamTexts((prev) => {
          if (!(msg.pageKey in prev)) return prev;
          const next = { ...prev };
          delete next[msg.pageKey];
          return next;
        });
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
        for (let i = 0; i < 6 && !acked; i++) {
          if (i > 0) await new Promise((r) => setTimeout(r, 250));
          acked = (await browser.runtime.sendMessage(start)) === true;
        }
        if (!acked) throw new Error('生成引擎未就绪（offscreen 无应答），请重试');
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
        const extract = await extractCurrentPage(tab.id, contentBudgetChars(currentProvider));
        const conv = conversationFromExtract({ pageKey: pageKeyOf(tab.url), url: tab.url, extract });
        setConversation(conv);
        await persistConversation(conv);
        setExtracting(false);
        await runTurn(
          firstUserContent ? 'chat' : 'summary',
          firstUserContent ?? summaryUserPrompt(settings),
          conv,
        );
      } catch (err) {
        setExtracting(false);
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
    void runTurn('summary', summaryUserPrompt(settings), base);
  }, [conversation, settings, runTurn, extractAndSummarize]);

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

      <main className="flex min-h-0 flex-1 flex-col">
        {!currentProvider ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
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
            isVideo={tab.url ? isYouTubeWatchUrl(tab.url) : false}
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
