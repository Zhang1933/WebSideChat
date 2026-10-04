import { Check, Copy, Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Conversation } from '@/types';

/** 调试模式：查看实际送入模型的提取正文（截断后）与元信息 */
export function ExtractViewerDialog({
  conversation,
  open,
  onOpenChange,
}: {
  conversation: Conversation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!conversation) return;
    await navigator.clipboard.writeText(conversation.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function download() {
    if (!conversation) return;
    const blob = new Blob([conversation.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `extract-${conversation.pageKey.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 60)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[92vw] max-w-2xl flex-col gap-2 p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            提取内容（送入模型的正文）
          </DialogTitle>
          <DialogDescription className="text-xs">
            {conversation && (
              <>
                {conversation.title} · {conversation.content.length.toLocaleString()} 字符
                {conversation.truncated ? '（已截断）' : ''} · 提取于{' '}
                {new Date(conversation.extractedAt).toLocaleString()}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <pre className="flex-1 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
          {conversation?.content || '（无内容）'}
        </pre>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => void copy()}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? '已复制' : '复制'}
          </Button>
          <Button variant="outline" size="sm" onClick={download}>
            <Download className="size-3.5" /> 下载 .md
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
