import {
  isChapterRefreshUrl,
  isPluginIssueReportUrl,
} from './sanitizeChapterText';

type LinkActions = {
  openNovel(url: string): boolean;
  openExternal(url: string): void;
  inject(script: string): void;
  refresh(): void;
};

export function handleReaderLink(
  data: unknown,
  actions: LinkActions,
  source: 'page' | 'native' | 'window' = 'page',
) {
  if (
    !data ||
    typeof data !== 'object' ||
    !('url' in data) ||
    typeof data.url !== 'string' ||
    (source === 'page' && !/^https?:/i.test(data.url))
  ) {
    return;
  }
  const url = data.url;
  if (isPluginIssueReportUrl(url)) {
    actions.openExternal(url);
  } else if (isChapterRefreshUrl(url)) {
    actions.refresh();
  } else if (!actions.openNovel(url)) {
    const target =
      'target' in data && typeof data.target === 'string'
        ? data.target.toLowerCase()
        : '';
    if (
      source === 'window' ||
      !['', '_self', '_parent', '_top'].includes(target)
    ) {
      actions.openExternal(url);
    } else if (source === 'page') {
      actions.inject(`window.location.href = ${JSON.stringify(url)}; true;`);
    } else {
      return true;
    }
  }
  return false;
}
