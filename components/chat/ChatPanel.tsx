import { Loader2, Send, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { Conversation } from '@/types';
import { MessageBubble } from './MessageBubble';

/** 追问区：消息列表（跳过摘要轮）+ 输入框，共享页面正文上下文 */
export function ChatPanel({
  conversation,
  enabled,
  streaming,
  streamText,
  onSend,
  onStop,
}: {
  conversation: Conversation;
  enabled: boolean;
  streaming: boolean;
  streamText: string;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // 摘要轮占 messages[0..1]，追问从第 2 条开始；摘要未完成前没有可追问的上下文
  const chatMessages = enabled ? conversation.messages.slice(2) : [];
  const showStreaming = enabled && streaming;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [conversation.messages.length, streamText]);

  function send() {
    const text = input.trim();
    if (!text || streaming || !enabled) return;
    setInput('');
    onSend(text);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        {chatMessages.length === 0 && !showStreaming && (
          <p className="py-2 text-center text-[11px] text-muted-foreground">
            {enabled ? '基于本页内容继续提问…' : '生成摘要后可追问'}
          </p>
        )}
        {chatMessages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}
        {showStreaming && (
          <>
            <MessageBubble message={{ role: 'assistant', content: streamText || '…' }} />
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
            </div>
          </>
        )}
        <div ref={bottomRef} />
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
          placeholder={enabled ? '针对本页内容提问，Enter 发送' : '请先生成摘要'}
          disabled={!enabled}
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
            disabled={!input.trim() || !enabled}
            onClick={send}
          >
            <Send className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
