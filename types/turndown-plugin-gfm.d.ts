declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';

  export const gfm: Parameters<TurndownService['use']>[0];
  export const tables: Parameters<TurndownService['use']>[0];
  export const strikethrough: Parameters<TurndownService['use']>[0];
  export const taskListItems: Parameters<TurndownService['use']>[0];
}
