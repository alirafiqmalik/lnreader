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

export function handleReaderLink(data: unknown, actions: LinkActions) {
  if (
    !data ||
    typeof data !== 'object' ||
    !('url' in data) ||
    typeof data.url !== 'string' ||
    !/^https?:/i.test(data.url)
  ) {
    return;
  }
  const url = data.url;
  if (isPluginIssueReportUrl(url)) {
    actions.openExternal(url);
  } else if (isChapterRefreshUrl(url)) {
    actions.refresh();
  } else if (!actions.openNovel(url)) {
    if ('target' in data && data.target === '_blank') actions.openExternal(url);
    else actions.inject(`window.location.href = ${JSON.stringify(url)}; true;`);
  }
}
