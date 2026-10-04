import { AlertCircle, Globe, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Header } from '@/components/Header';
import { PageBar } from '@/components/PageBar';
import { StaleBanner } from '@/components/StaleBanner';
import { SummaryCard } from '@/components/SummaryCard';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { ProvidersPage } from '@/components/providers/ProvidersPage';
import { hasSummary, withMessage } from '@/lib/conversation';
import { conversationFromExtract, extractCurrentPage, ExtractError } from '@/lib/extract';
import { describeLlmError, streamChat } from '@/lib/llm/client';
import { buildSystemPrompt, summaryUserPrompt } from '@/lib/prompts';
import {
  conversationsItem,
  currentProviderIdItem,
  persistConversation,
  providersItem,
  settingsItem,
} from '@/lib/storage';
import { useActiveTab } from '@/lib/tabs';
import { pageKeyOf } from '@/lib/utils';
import { DEFAULT_SETTINGS, type AppSettings, type ChatMessage, type Conversation, type Provider } from '@/types';

type StreamTarget = 'summary' | 'chat' | null;

export default function App() {
  const [view, setView] = useState<'workspace' | 'settings'>('workspace');
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
  const [streaming, setStreaming] = useState(false);
  const [streamTarget, setStreamTarget] = useState<StreamTarget>(null);
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // 轮次守卫：切页/发起新轮次后，旧流的回调不得再覆盖会话状态
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
    // 切页时中断进行中的流
    return () => {
      cancelled = true;
      abortRef.current?.abort();
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

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      const turnId = ++turnSeqRef.current;
      const isActive = () => turnId === turnSeqRef.current && base.pageKey === pageKeyRef.current;

      const withUser = withMessage(base, { role: 'user', content: userContent } satisfies ChatMessage);
      setConversation(withUser);
      setStreaming(true);
      setStreamTarget(target);
      setStreamText('');
      setError(null);

      let acc = '';

      await streamChat(
        p,
        {
          system: buildSystemPrompt(withUser, settings),
          messages: withUser.messages,
          maxTokens: 4096,
        },
        {
          onDelta: (full) => {
            acc = full;
            setStreamText(full);
          },
          onDone: (full) => {
            if (!isActive()) return;
            const fin = withMessage(withUser, { role: 'assistant', content: full });
            setConversation(fin);
            void persistConversation(fin);
          },
          onError: (err) => {
            if (!isActive()) return;
            if (acc.trim()) {
              // 中断/出错但已有部分内容：保留并标注
              const fin = withMessage(withUser, {
                role: 'assistant',
                content: acc + '\n\n> ⚠️ ' + (err.kind === 'aborted' ? '生成已中断' : describeLlmError(err)),
              });
              setConversation(fin);
              void persistConversation(fin);
            } else {
              // 一无所获：回滚本轮用户消息，便于重试
              setConversation(base);
              setError(describeLlmError(err));
            }
          },
          signal: ac.signal,
        },
      );

      setStreaming(false);
      setStreamTarget(null);
      setStreamText('');
    },
    [currentProvider, settings],
  );

  /** 提取正文 + 生成摘要（首次或重新提取） */
  const extractAndSummarize = useCallback(async () => {
    if (tab.id == null || !tab.url) {
      setError('没有可提取的页面');
      return;
    }
    if (!currentProvider) {
      setError('请先在设置中配置并启用一个供应商');
      return;
    }
    abortRef.current?.abort();
    setExtracting(true);
    setError(null);
    try {
      const extract = await extractCurrentPage(tab.id, settings.maxContentChars);
      const conv = conversationFromExtract({ pageKey: pageKeyOf(tab.url), url: tab.url, extract });
      setConversation(conv);
      await persistConversation(conv);
      setExtracting(false);
      await runTurn('summary', summaryUserPrompt(settings), conv);
    } catch (err) {
      setExtracting(false);
      setError(err instanceof ExtractError ? err.message : `提取失败：${String(err)}`);
    }
  }, [tab.id, tab.url, currentProvider, settings, runTurn]);

  /** 已有会话时的重新提取（清空旧摘要与对话） */
  const reextract = useCallback(() => {
    if (conversation && conversation.messages.length > 0) {
      if (!confirm('重新提取将清空当前摘要与对话记录，继续？')) return;
    }
    void extractAndSummarize();
  }, [conversation, extractAndSummarize]);

  /** 已有正文时的"生成/重新生成摘要"：重新生成会清空旧摘要与追问 */
  const generateSummaryOnly = useCallback(() => {
    if (!conversation) {
      void extractAndSummarize();
      return;
    }
    const base = hasSummary(conversation) ? { ...conversation, messages: [] } : conversation;
    void runTurn('summary', summaryUserPrompt(settings), base);
  }, [conversation, settings, runTurn, extractAndSummarize]);

  const sendQuestion = useCallback(
    (text: string) => {
      if (!conversation || streaming) return;
      void runTurn('chat', text, conversation);
    },
    [conversation, streaming, runTurn],
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ---- 渲染 ----

  if (view === 'settings') {
    return (
      <div className="h-screen">
        <ProvidersPage onBack={() => setView('workspace')} />
      </div>
    );
  }

  const ready = hasSummary(conversation);
  const summaryStreaming = streaming && streamTarget === 'summary';

  return (
    <div className="flex h-screen flex-col bg-background">
      <Header
        providers={providerList}
        currentProvider={currentProvider}
        onOpenSettings={() => setView('settings')}
      />
      <PageBar
        url={tab.url}
        title={tab.title}
        conversation={conversation}
        extracting={extracting}
        onReextract={reextract}
      />
      {conversation && !streaming && !extracting && (
        <StaleBanner extractedAt={conversation.extractedAt} onReextract={reextract} />
      )}

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
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <Globe className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">还没有配置 LLM 供应商</p>
            <button
              className="text-sm text-primary underline underline-offset-4"
              onClick={() => setView('settings')}
            >
              去添加供应商
            </button>
          </div>
        ) : !conversation ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <Sparkles className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {extracting
                ? '正在提取页面正文…'
                : tab.url
                  ? '提取当前页面并生成 AI 摘要'
                  : '打开一个网页后再试'}
            </p>
            {tab.url && !extracting && (
              <button
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
                disabled={streaming}
                onClick={() => void extractAndSummarize()}
              >
                {extracting ? '提取中…' : '提取并生成摘要'}
              </button>
            )}
          </div>
        ) : (
          <>
            <SummaryCard
              conversation={conversation}
              hasSummary={ready}
              streaming={summaryStreaming}
              streamText={streamText}
              disabled={!tab.url || streaming || extracting}
              onGenerate={generateSummaryOnly}
              onStop={stopStreaming}
            />
            <ChatPanel
              conversation={conversation}
              enabled={ready}
              streaming={streaming && streamTarget === 'chat'}
              streamText={streamText}
              onSend={sendQuestion}
              onStop={stopStreaming}
            />
          </>
        )}
      </main>
    </div>
  );
}
