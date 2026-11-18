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

export function createReaderLinkHandlers(actions: LinkActions) {
  const handleSpecial = (url: string): boolean => {
    if (isPluginIssueReportUrl(url)) actions.openExternal(url);
    else if (isChapterRefreshUrl(url)) actions.refresh();
    else return actions.openNovel(url);
    return true;
  };
  const openWindow = (url: string): void => {
    if (/^(about|javascript):/i.test(url)) return;
    if (!handleSpecial(url)) actions.openExternal(url);
  };
  const shouldStartLoad = (url: string): boolean => !handleSpecial(url);
  const handlePage = (data: unknown): void => {
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
    if (handleSpecial(url)) return;
    const target =
      'target' in data && typeof data.target === 'string'
        ? data.target.toLowerCase()
        : '';
    if (!['', '_self', '_parent', '_top'].includes(target)) {
      actions.openExternal(url);
    } else {
      actions.inject(`window.location.href = ${JSON.stringify(url)}; true;`);
    }
  };
  return { handlePage, shouldStartLoad, openWindow };
}
