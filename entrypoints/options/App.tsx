import { MessageSquareText, Server } from 'lucide-react';
import { useState } from 'react';
import { ProvidersPage } from '@/components/providers/ProvidersPage';
import { PromptSettingsPage } from '@/components/settings/PromptSettingsPage';
import { cn } from '@/lib/utils';

type Section = 'providers' | 'prompts';

const NAV: { id: Section; label: string; icon: typeof Server }[] = [
  { id: 'providers', label: '供应商设置', icon: Server },
  { id: 'prompts', label: '提示词设置', icon: MessageSquareText },
];

/** 设置整页（新标签页）：左侧导航 + 右侧内容 */
export default function App() {
  const params = new URLSearchParams(window.location.search);
  const [section, setSection] = useState<Section>('providers');

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-44 shrink-0 flex-col border-r">
        <div className="border-b px-4 py-4">
          <h1 className="text-base font-bold">WebSideChat</h1>
          <p className="text-[11px] text-muted-foreground">设置</p>
        </div>
        <nav className="flex flex-col gap-0.5 p-2">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={cn(
                'flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors',
                section === id
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 p-6">
        <div className="mx-auto max-w-3xl">
          {section === 'providers' && (
            <ProvidersPage initialEditId={params.get('edit')} initialAdd={params.has('add')} />
          )}
          {section === 'prompts' && <PromptSettingsPage />}
        </div>
      </main>
    </div>
  );
}
