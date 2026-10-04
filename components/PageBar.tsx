import { FileText, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Conversation } from '@/types';

/** 当前页信息条：标题 + 域名 + 提取状态徽标 + 重新提取 */
export function PageBar({
  url,
  title,
  conversation,
  extracting,
  debug,
  onViewContent,
  onReextract,
}: {
  url: string | null;
  title: string | null;
  conversation: Conversation | null;
  extracting: boolean;
  /** 调试模式：字符徽标可点击查看提取内容 */
  debug?: boolean;
  onViewContent: () => void;
  onReextract: () => void;
}) {
  let domain = '';
  try {
    domain = url ? new URL(url).hostname : '';
  } catch {
    domain = '';
  }

  return (
    <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">
          {title || conversation?.title || domain || '无活动标签页'}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">{domain}</p>
      </div>
      {conversation && (
        <>
          {debug ? (
            <button
              type="button"
              onClick={onViewContent}
              title="查看提取内容（调试）"
              className="shrink-0 rounded-full border border-dashed px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              已提取 {conversation.content.length.toLocaleString()} 字符
              {conversation.truncated ? '（截断）' : ''} ▸
            </button>
          ) : (
            <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
              已提取 {conversation.content.length.toLocaleString()} 字符
              {conversation.truncated ? '（截断）' : ''}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="重新提取并生成摘要"
            title="重新提取正文并重新生成摘要"
            disabled={!url || extracting}
            onClick={onReextract}
          >
            <RefreshCw className={extracting ? 'size-3.5 animate-spin' : 'size-3.5'} />
          </Button>
        </>
      )}
    </div>
  );
}
