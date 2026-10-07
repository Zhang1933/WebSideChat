import { Check, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { Provider } from '@/types';
import { ProviderIcon } from './ProviderIcon';

/** 供应商卡片（对齐 cc-switch ProviderCard：当前项高亮 + 使用中徽标） */
export function ProviderCard({
  provider,
  isCurrent,
  onUse,
  onEdit,
  onDelete,
}: {
  provider: Provider;
  isCurrent: boolean;
  onUse: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border bg-card p-3',
        isCurrent ? 'border-primary/60 ring-1 ring-primary/30' : 'border-border',
      )}
    >
      <ProviderIcon icon={provider.icon} iconColor={provider.iconColor} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{provider.name}</span>
          {isCurrent && (
            <Badge variant="default" className="h-4 shrink-0 px-1.5 text-[10px]">
              {t('common.inUse')}
            </Badge>
          )}
        </div>
        <p className="truncate text-[11px] text-muted-foreground">{provider.baseUrl}</p>
        <p className="truncate text-[11px] text-muted-foreground/80">{provider.model}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {isCurrent ? (
          <span className="inline-flex items-center gap-1 pr-1 text-xs text-primary">
            <Check className="size-3.5" />
          </span>
        ) : (
          <Button variant="secondary" size="sm" onClick={onUse}>
            {t('common.use')}
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" aria-label={t('common.edit')} onClick={onEdit}>
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('common.delete')}
          className="text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
