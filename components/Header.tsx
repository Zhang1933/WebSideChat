import { Check, ChevronDown, Pin, PinOff, Settings, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useT } from '@/lib/i18n';
import { currentProviderIdItem } from '@/lib/storage';
import type { Provider } from '@/types';
import { ProviderIcon } from './providers/ProviderIcon';

/**
 * 顶部：当前供应商下拉切换 + 设置入口（联动 chrome.storage.watch）。
 * 抽屉模式（iframe 注入）额外显示 pin（新标签页自动展开）与 ×（关闭本页抽屉）。
 */
export function Header({
  providers,
  currentProvider,
  inDrawer,
  drawerPinned,
  onToggleDrawerPin,
  onCloseDrawer,
  onOpenSettings,
}: {
  providers: Provider[];
  currentProvider: Provider | null;
  /** 是否运行在注入式抽屉（iframe）中 */
  inDrawer: boolean;
  /** 抽屉模式：全局 pin 状态（新标签页自动展开） */
  drawerPinned: boolean;
  onToggleDrawerPin: () => void;
  onCloseDrawer: () => void;
  onOpenSettings: () => void;
}) {
  const t = useT();
  return (
    <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-accent"
          >
            <ProviderIcon
              icon={currentProvider?.icon ?? 'custom'}
              iconColor={currentProvider?.iconColor}
              className="size-6 text-[10px]"
            />
            <span className="truncate">
              {currentProvider ? currentProvider.name : t('header.noProvider')}
            </span>
            {currentProvider && (
              <span className="hidden truncate text-xs text-muted-foreground xl:inline">
                {currentProvider.model}
              </span>
            )}
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {t('header.switchProvider')}
          </DropdownMenuLabel>
          {providers.map((p) => (
            <DropdownMenuItem key={p.id} onClick={() => void currentProviderIdItem.setValue(p.id)}>
              <ProviderIcon icon={p.icon} iconColor={p.iconColor} className="size-5 text-[9px]" />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.id === currentProvider?.id && <Check className="size-3.5" />}
            </DropdownMenuItem>
          ))}
          {providers.length === 0 && (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">
              {t('header.emptyHint')}
            </div>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onOpenSettings}>
            <Settings className="size-3.5" /> {t('header.manage')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={drawerPinned ? t('header.pinOnAria') : t('header.pinOffAria')}
          title={drawerPinned ? t('header.pinOn') : t('header.pinOff')}
          onClick={onToggleDrawerPin}
        >
          {drawerPinned ? (
            <Pin className="size-4 fill-current text-primary" />
          ) : (
            <PinOff className="size-4" />
          )}
        </Button>
        {inDrawer && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('header.closeDrawerAria')}
            title={t('header.closeDrawer')}
            onClick={onCloseDrawer}
          >
            <X className="size-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" aria-label={t('common.settings')} onClick={onOpenSettings}>
          <Settings className="size-4" />
        </Button>
      </div>
    </header>
  );
}
