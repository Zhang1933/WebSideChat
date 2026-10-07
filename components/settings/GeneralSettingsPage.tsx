import { Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { defaultUiLang, useT } from '@/lib/i18n';
import { saveSettings, settingsItem } from '@/lib/storage';
import type { AppSettings } from '@/types';

/** 通用设置（设置首页）：显示语言。摘要语言等与供应商相关的设置在供应商页底部 */
export function GeneralSettingsPage() {
  const t = useT();
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    void settingsItem.getValue().then(setSettings);
    return settingsItem.watch(setSettings);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Settings2 className="size-4" />
          {t('options.nav.general')}
        </div>
        <div className="flex max-w-xs flex-col gap-1.5">
          <Label>{t('providers.uiLang')}</Label>
          <Select
            value={settings?.uiLang ?? defaultUiLang()}
            onValueChange={(v) => void saveSettings({ uiLang: v as AppSettings['uiLang'] })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh">中文</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="mt-2 flex max-w-xs flex-col gap-1.5">
          <Label>{t('providers.summaryLang')}</Label>
          <Select
            value={settings?.summaryLanguage ?? defaultUiLang()}
            onValueChange={(v) =>
              void saveSettings({ summaryLanguage: v as AppSettings['summaryLanguage'] })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh">中文</SelectItem>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="auto">{t('providers.summaryLangAuto')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
