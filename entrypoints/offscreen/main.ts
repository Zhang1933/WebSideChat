import { browser } from '#imports';
import { CONTEXT_COMPRESSED_MARKER, withMessage } from '@/lib/conversation';
import { compressThreshold, estimateConversationTokens } from '@/lib/context';
import { compressHistory, describeLlmError, streamChat } from '@/lib/llm/client';
import { defaultUiLang, setUiLang, t } from '@/lib/i18n';
import { buildSystemPrompt } from '@/lib/prompts';
import { effectiveContextLimit } from '@/lib/utils';
import type { TurnMessage } from '@/lib/turnMessages';
import type { ChatMessage } from '@/types';

/**
 * Offscreen Document：LLM 回合引擎（常驻后台页，不受 Service Worker idle
 * 回收与侧边栏关闭影响）。职责：接收 turn:start → 拼装消息 → 上下文压缩 →
 * 流式请求 → 广播事件给 background（落库）与所有面板（视图）。
 * 注意：offscreen 文档没有 chrome.storage——持久化由 background 监听
 * turn:started / turn:done / turn:error 事件完成。
 * 同一 pageKey 串行：新回合开始时中止该页旧流。
 */

const controllers = new Map<string, AbortController>();
const activePages = new Set<string>();
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function emit(msg: TurnMessage) {
  void browser.runtime.sendMessage(msg).catch(() => {});
}

/** 全部流结束且空闲 2 分钟 → 通知 background 关闭本文档（省内存） */
function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (activePages.size === 0) emit({ type: 'offscreen:idle' });
  }, 2 * 60_000);
}

browser.runtime.onMessage.addListener((msg: TurnMessage) => {
  if (msg?.type === 'turn:start') {
    void handleTurnStart(msg);
    // 回执：面板据此确认引擎已就绪并接到本回合（createDocument 先于脚本就绪的经典竞态）
    return Promise.resolve(true);
  }
  if (msg?.type === 'turn:cancel') controllers.get(msg.pageKey)?.abort();
});

async function handleTurnStart(msg: Extract<TurnMessage, { type: 'turn:start' }>) {
  const { streamId, pageKey, provider, settings, conversation: base, userContent, target } = msg;

  // offscreen 不读 storage：语言随回合消息携带，占位/错误文案按用户设置输出
  setUiLang(settings.uiLang ?? defaultUiLang());

  console.log('[WebSideChat offscreen] turn:start 收到', {
    pageKey,
    target,
    provider: provider.name,
    model: provider.model,
  });

  // 同页只保留一条流：中止旧流
  controllers.get(pageKey)?.abort();
  const ac = new AbortController();
  controllers.set(pageKey, ac);
  activePages.add(pageKey);
  resetIdleTimer();

  try {
    let convNow = withMessage(base, { role: 'user', content: userContent } satisfies ChatMessage);
    if (target === 'summary') convNow = { ...convNow, summaryPrompt: userContent };
    // 开跑即广播：background 收到后落库（面板中途关闭重开时能看到待回答的问题）
    emit({ type: 'turn:started', streamId, pageKey, conversation: convNow });

    // ---- 上下文预算：超阈值先压缩历史，仍超再逐步缩减正文 ----
    const threshold = compressThreshold(effectiveContextLimit(provider));
    let sys = buildSystemPrompt(convNow, settings);
    if (estimateConversationTokens(sys, convNow.messages) > threshold) {
      const pending = convNow.messages[convNow.messages.length - 1]!;
      const history = convNow.messages.slice(0, -1);
      if (history.length >= 2) {
        let digest: string | null = null;
        try {
          digest = (await compressHistory(provider, history, ac.signal)).trim() || null;
        } catch {
          digest = null; // 压缩调用失败 → 走正文缩减兜底
        }
        if (digest) {
          convNow = {
            ...convNow,
            messages: [
              { role: 'user', content: CONTEXT_COMPRESSED_MARKER },
              { role: 'assistant', content: digest },
              pending,
            ],
          };
          sys = buildSystemPrompt(convNow, settings);
        }
      }
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
    }

    let acc = '';
    console.log('[WebSideChat offscreen] streamChat 开始', {
      apiFormat: provider.apiFormat,
      baseUrl: provider.baseUrl,
      model: provider.model,
      hasKey: !!provider.apiKey,
      hasAccountId: !!provider.accountId,
      messageCount: convNow.messages.length,
    });
    await streamChat(
      provider,
      { system: sys, messages: convNow.messages, maxTokens: 4096 },
      {
        onDelta: (full) => {
          acc = full;
          emit({ type: 'turn:delta', streamId, pageKey, full });
        },
        onDone: (full) => {
          console.log('[WebSideChat offscreen] 流完成', { len: full.length });
          const fin = withMessage(convNow, { role: 'assistant', content: full });
          emit({ type: 'turn:done', streamId, pageKey, conversation: fin });
        },
        onError: (err) => {
          console.error('[WebSideChat offscreen] streamChat 错误', {
            kind: err.kind,
            message: err.message,
            status: err.status,
            partialLength: acc.length,
          });
          let fin;
          if (acc.trim()) {
            // 中断/出错但已有部分内容：保留并标注
            fin = withMessage(convNow, {
              role: 'assistant',
              content: acc + '\n\n> ⚠️ ' + (err.kind === 'aborted' ? t('turn.interrupted') : describeLlmError(err)),
            });
          } else {
            // 一无所获：保留用户提问，补占位回复维持角色交替
            fin = withMessage(convNow, {
              role: 'assistant',
              content: err.kind === 'aborted' ? t('turn.stoppedPlaceholder') : t('turn.emptyPlaceholder'),
            });
          }
          emit({
            type: 'turn:error',
            streamId,
            pageKey,
            error: err.kind === 'aborted' ? '' : describeLlmError(err),
            conversation: fin,
          });
        },
        signal: ac.signal,
      },
    );
  } catch (err) {
    // 引擎内部异常（拼装/压缩阶段抛错）没有 catch 的话是未捕获 rejection：
    // 面板会永远转圈、任何 turn:error 都不发——必须兜住并回报
    console.error('[WebSideChat offscreen] 回合内部异常:', err);
    const fin = withMessage(
      withMessage(base, { role: 'user', content: userContent } satisfies ChatMessage),
      { role: 'assistant', content: t('turn.internalErr') },
    );
    emit({
      type: 'turn:error',
      streamId,
      pageKey,
      error: t('turn.internalErrDetail', err instanceof Error ? err.message : String(err)),
      conversation: fin,
    });
  } finally {
    controllers.delete(pageKey);
    activePages.delete(pageKey);
    resetIdleTimer();
  }
}
