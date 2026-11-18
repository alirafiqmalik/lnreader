import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { handleReaderLink } from '../handleReaderLink';

jest.mock('sanitize-html', () => ({
  __esModule: true,
  default: Object.assign(jest.fn(), { defaults: { allowedTags: ['p'] } }),
}));

describe('reader link messages', () => {
  const url = 'https://royalroad.com/fiction/123';
  it.each(['', '_blank'])('opens a novel in the app (%s)', target => {
    const openNovel = jest.fn(() => true);
    const openExternal = jest.fn();
    const inject = jest.fn();
    handleReaderLink(
      { url, target },
      { openNovel, openExternal, inject, refresh: jest.fn() },
    );
    expect(openNovel).toHaveBeenCalledWith(url);
    expect(openExternal).not.toHaveBeenCalled();
    expect(inject).not.toHaveBeenCalled();
  });
  it.each(['', '_blank'])('preserves other link behavior (%s)', target => {
    const openExternal = jest.fn();
    const inject = jest.fn();
    handleReaderLink(
      { url, target },
      { openNovel: () => false, openExternal, inject, refresh: jest.fn() },
    );
    expect(openExternal.mock.calls).toEqual(target ? [[url]] : []);
    const navigationScript = expect.stringContaining(JSON.stringify(url));
    expect(inject.mock.calls).toEqual(target ? [] : [[navigationScript]]);
  });
});

it('dispatches a novel link message to app navigation', () => {
  const source = readFileSync(
    'src/screens/reader/components/WebViewReader.tsx',
    'utf8',
  );
  const start = source.indexOf("case 'link':");
  const dispatch =
    start < 0
      ? ''
      : source.slice(start, source.indexOf("case 'tts-queue':", start));
  const openNovelLink = jest.fn(() => true);
  runInNewContext(`switch (event.type) { ${dispatch} }`, {
    event: {
      type: 'link',
      data: { url: 'https://royalroad.com/fiction/123', target: '' },
    },
    handleReaderLink,
    openNovelLink,
    Linking: { openURL: jest.fn() },
    webViewRef: { current: { injectJavaScript: jest.fn() } },
    refetch: jest.fn(),
  });
  expect(openNovelLink).toHaveBeenCalledWith(
    'https://royalroad.com/fiction/123',
  );
});
