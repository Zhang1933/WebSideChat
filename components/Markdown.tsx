import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

/** Markdown 渲染（摘要与回复共用，支持流式增量重渲染） */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none break-words prose-headings:mb-1 prose-headings:mt-3 prose-p:my-1.5 prose-li:my-0.5 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
