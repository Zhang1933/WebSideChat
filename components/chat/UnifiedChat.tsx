import { Loader2, Send, Sparkles, Square } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CONTEXT_COMPRESSED_MARKER } from '@/lib/conversation';
import type { Conversation } from '@/types';
import { MessageBubble } from './MessageBubble';

/**
 * 统一对话流：摘要即第一条 AI 消息（messages[1]），追问接续在后。
 * messages[0] 是固定的摘要指令（canned prompt），不展示。
 */
export function UnifiedChat({
  conversation,
  ready,
  streaming,
  streamText,
  disabled,
  onGenerateSummary,
  onSend,
  onStop,
}: {
  conversation: Conversation;
  /** 摘要轮已完成（首条 assistant 消息存在） */
  ready: boolean;
  streaming: boolean;
  streamText: string;
  /** 无活动页面 / 提取中 / 生成中 */
  disabled: boolean;
  onGenerateSummary: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  // 贴底跟随：只有用户停留在底部附近时才自动滚动，翻阅历史不被拽回
  const stickToBottomRef = useRef(true);

  const visibleMessages = conversation.messages.slice(1);

  function handleListScroll() {
    const el = listRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottomRef.current) {
      // 直接滚容器自身，避免 scrollIntoView 连带滚动祖先容器
      el.scrollTop = el.scrollHeight;
    }
  }, [conversation.messages.length, streamText]);

  function send() {
    const text = input.trim();
    if (!text || streaming || !ready) return;
    setInput('');
    onSend(text);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={listRef}
        onScroll={handleListScroll}
        className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3"
      >
        {!ready && !streaming && (
          <div className="flex flex-col items-center gap-2 py-6">
            <p className="text-[11px] text-muted-foreground">生成摘要后即可针对本页内容追问</p>
            <Button size="sm" disabled={disabled} onClick={onGenerateSummary}>
              <Sparkles className="size-3.5" /> 生成摘要
            </Button>
          </div>
        )}

        {visibleMessages.map((m, i) => {
          // 压缩标记 → 提示行（不渲染为气泡）
          if (m.role === 'user' && m.content === CONTEXT_COMPRESSED_MARKER) {
            return (
              <div
                key={i}
                className="rounded-md border border-dashed px-2 py-1 text-center text-[11px] text-muted-foreground"
              >
                上文已压缩：早期对话已摘要为下方纪要，可继续追问
              </div>
            );
          }
          const isDigest =
            i > 0 &&
            visibleMessages[i - 1]!.role === 'user' &&
            visibleMessages[i - 1]!.content === CONTEXT_COMPRESSED_MARKER;
          return (
            <Fragment key={i}>
              <MessageBubble message={m} muted={isDigest} />
            </Fragment>
          );
        })}

        {streaming && (
          <>
            <MessageBubble message={{ role: 'assistant', content: streamText || '…' }} />
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
            </div>
          </>
        )}
      </div>

      <div className="flex items-end gap-2 border-t p-2.5">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={ready ? '针对本页内容提问，Enter 发送' : '请先生成摘要'}
          disabled={!ready}
          rows={2}
          className="max-h-32 min-h-9 resize-none text-sm"
        />
        {streaming ? (
          <Button variant="secondary" size="icon-sm" aria-label="停止" onClick={onStop}>
            <Square className="size-3.5" />
          </Button>
        ) : (
          <Button
            size="icon-sm"
            aria-label="发送"
            disabled={!input.trim() || !ready}
            onClick={send}
          >
            <Send className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
