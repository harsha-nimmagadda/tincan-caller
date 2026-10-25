import { en } from './en';

export type MessageKey = keyof typeof en;

const messages: Record<string, Record<MessageKey, string>> = { en };

function pickLocale(): string {
  const langs = typeof navigator === 'undefined' ? [] : navigator.languages;
  for (const l of langs) {
    const base = l.split('-')[0]?.toLowerCase();
    if (base && base in messages) return base;
  }
  return 'en';
}

export const locale = pickLocale();

/** Look up a UI string; `{name}` placeholders are replaced from `params`. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = (messages[locale] ?? en)[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => String(params[name] ?? m));
}
