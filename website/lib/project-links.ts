import type { Lang } from './catalog';

export const repositoryUrl = 'https://github.com/nanfengw0w/varyloom';
export const npmUrl = 'https://www.npmjs.com/package/varyloom';

export function apiUrl(lang: Lang, effect?: string): string {
  const file = lang === 'zh' ? 'API.zh-CN.md' : 'API.md';
  return `${repositoryUrl}/blob/main/docs/${file}${effect ? `#effect-${effect}` : ''}`;
}
