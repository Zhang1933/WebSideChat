import { AlertCircle, Globe, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExtractViewerDialog } from '@/components/ExtractViewerDialog';
import { Header } from '@/components/Header';
import { PageBar } from '@/components/PageBar';
import { UnifiedChat } from '@/components/chat/UnifiedChat';
import { CONTEXT_COMPRESSED_MARKER, hasSummary, visibleStartIndex, withMessage } from '@/lib/conversation';
import { compressThreshold, estimateConversationTokens } from '@/lib/context';
import { conversationFromExtract, extractCurrentPage, ExtractError } from '@/lib/extract';
import { compressHistory, describeLlmError, streamChat } from '@/lib/llm/client';
import { openProviderManager } from '@/lib/openOptions';
import { buildSystemPrompt, summaryUserPrompt } from '@/lib/prompts';
import {
  conversationsItem,
  currentProviderIdItem,
  persistConversation,
  providersItem,
  settingsItem,
} from '@/lib/storage';
import { useActiveTab } from '@/lib/tabs';
import { contentBudgetChars, effectiveContextLimit, pageKeyOf } from '@/lib/utils';
import { isYouTubeWatchUrl } from '@/lib/youtube';
import { DEFAULT_SETTINGS, type AppSettings, type ChatMessage, type Conversation, type Provider } from '@/types';


export default function App() {
  const tab = useActiveTab();
  const pageKey = tab.url ? pageKeyOf(tab.url) : null;

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
  // 每个页面独立的流控制器与轮次守卫（跨页互不影响）
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const turnIdsRef = useRef<Map<string, number>>(new Map());
  const turnSeqRef = useRef(0);
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
    // 切页不中断进行中的流：生成在后台继续完成并持久化到原页面会话
    return () => {
      cancelled = true;
    };
  }, [pageKey]);

  // ---- 核心动作 ----

  /** 发起一轮流式对话（摘要轮或追问轮） */
  const runTurn = useCallback(
    async (target: 'summary' | 'chat', userContent: string, base: Conversation) => {
      const p = currentProvider;
      if (!p) {
        setError('请先在设置中配置并启用一个供应商');
        return;
      }

      // 同一页面只保留一条流：发起新轮次前中止本页旧流（其他页面的流不受影响）
      controllersRef.current.get(base.pageKey)?.abort();
      const ac = new AbortController();
      controllersRef.current.set(base.pageKey, ac);

      const turnId = ++turnSeqRef.current;
      turnIdsRef.current.set(base.pageKey, turnId);
      // 轮次守卫：本页发起新轮次后，旧流不再写入状态/存储
      const isActive = () => turnIdsRef.current.get(base.pageKey) === turnId;
      // 视图守卫：切页后旧流仍完成后台持久化，但不再更新当前视图
      const isViewing = () => base.pageKey === pageKeyRef.current;

      let convNow = withMessage(base, { role: 'user', content: userContent } satisfies ChatMessage);
      // 摘要轮的固定指令在 UI 中隐藏，记录原文供展示层识别
      if (target === 'summary') convNow = { ...convNow, summaryPrompt: userContent };
      if (isViewing()) setConversation(convNow);
      setStreamTexts((prev) => ({ ...prev, [base.pageKey]: '' }));
      if (isViewing()) setError(null);

      // ---- 上下文预算：超阈值先调模型压缩历史，仍超再逐步缩减正文 ----
      const threshold = compressThreshold(effectiveContextLimit(p));
      let sys = buildSystemPrompt(convNow, settings);
      if (estimateConversationTokens(sys, convNow.messages) > threshold) {
        const pending = convNow.messages[convNow.messages.length - 1]!;
        const history = convNow.messages.slice(0, -1);
        if (history.length >= 2) {
          let digest: string | null = null;
          try {
            digest = (await compressHistory(p, history, ac.signal)).trim() || null;
          } catch {
            digest = null; // 压缩调用失败 → 走正文缩减兜底
          }
          if (!isActive()) return;
          if (digest) {
            convNow = {
              ...convNow,
              messages: [
                { role: 'user', content: CONTEXT_COMPRESSED_MARKER },
                { role: 'assistant', content: digest },
                pending,
              ],
            };
            if (isViewing()) setConversation(convNow);
            sys = buildSystemPrompt(convNow, settings);
          }
        }
        // 仍超阈值（或压缩失败）：逐步缩减正文，直到估算放得下
        while (
          estimateConversationTokens(sys, convNow.messages) > threshold &&
          convNow.content.length > 8_000
        ) {
          convNow = {
            ...convNow,
            content: convNow.content.slice(0, Math.floor(convNow.content.length * 0.6)),
            truncated: true,
          };
          sys = buildSystemPrompt(convNow, settings);
        }
        void persistConversation(convNow);
      }

      let acc = '';

      await streamChat(
        p,
        {
          system: sys,
          messages: convNow.messages,
          maxTokens: 4096,
        },
        {
          onDelta: (full) => {
            acc = full;
            setStreamTexts((prev) => ({ ...prev, [base.pageKey]: full }));
          },
          onDone: (full) => {
            if (!isActive()) return;
            const fin = withMessage(convNow, { role: 'assistant', content: full });
            // 后台完成（用户已切走）：照常落库，回来即见
            void persistConversation(fin);
            if (isViewing()) setConversation(fin);
          },
          onError: (err) => {
            if (!isActive()) return;
            if (acc.trim()) {
              // 中断/出错但已有部分内容：保留并标注
              const fin = withMessage(convNow, {
                role: 'assistant',
                content: acc + '\n\n> ⚠️ ' + (err.kind === 'aborted' ? '生成已中断' : describeLlmError(err)),
              });
              void persistConversation(fin);
              if (isViewing()) setConversation(fin);
            } else {
              // 一无所获：保留用户提问（不回滚），补占位回复维持角色交替
              const fin = withMessage(convNow, {
                role: 'assistant',
                content: err.kind === 'aborted' ? '*（已停止，未生成内容）*' : '*（未生成内容，请重试）*',
              });
              void persistConversation(fin);
              if (isViewing()) {
                setConversation(fin);
                if (err.kind !== 'aborted') setError(describeLlmError(err));
              }
            }
          },
          signal: ac.signal,
        },
      );

      // 结束本页流：清理隔离状态（不影响其他页面的进行中流）
      setStreamTexts((prev) => {
        const next = { ...prev };
        delete next[base.pageKey];
        return next;
      });
      controllersRef.current.delete(base.pageKey);
      turnIdsRef.current.delete(base.pageKey);
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

  /** 停止当前查看页面的流（其他页面的后台流不受影响） */
  const stopStreaming = useCallback(() => {
    if (pageKey) controllersRef.current.get(pageKey)?.abort();
  }, [pageKey]);

  // ---- 渲染 ----


  return (
    <div className="flex h-screen flex-col bg-background">
      <Header
        providers={providerList}
        currentProvider={currentProvider}
        onOpenSettings={() => openProviderManager()}
      />
      <PageBar
        url={tab.url}
        title={tab.title}
        conversation={conversation}
        extracting={extracting}
        debug={settings.debugMode}
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
