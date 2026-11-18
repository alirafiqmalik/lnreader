import { handleReaderLink } from '../handleReaderLink';

jest.mock('sanitize-html', () => ({
  __esModule: true,
  default: Object.assign(jest.fn(), { defaults: { allowedTags: ['p'] } }),
}));

describe('reader link messages', () => {
  const url = 'https://royalroad.com/fiction/123';
  it.each(['', '_blank', '_BLANK', '_new', 'named'])(
    'opens a novel in the app (%s)',
    target => {
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
    },
  );
  it.each(['', '_blank', '_BLANK', '_new', 'named'])(
    'preserves other link behavior (%s)',
    target => {
      const openExternal = jest.fn();
      const inject = jest.fn();
      handleReaderLink(
        { url, target },
        { openNovel: () => false, openExternal, inject, refresh: jest.fn() },
      );
      expect(openExternal.mock.calls).toEqual(target ? [[url]] : []);
      const navigationScript = expect.stringContaining(JSON.stringify(url));
      expect(inject.mock.calls).toEqual(target ? [] : [[navigationScript]]);
    },
  );
});

it.each(['native', 'window'] as const)(
  'routes native refresh through %s',
  source => {
    const refresh = jest.fn();
    const openNovel = jest.fn(() => false);
    expect(
      handleReaderLink(
        { url: 'lnreader://refresh-chapter' },
        { refresh, openNovel, openExternal: jest.fn(), inject: jest.fn() },
        source,
      ),
    ).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(openNovel).not.toHaveBeenCalled();
  },
);
it.each(['page', 'native', 'window'] as const)(
  'routes issue reports externally through %s',
  source => {
    const openExternal = jest.fn();
    const url = 'https://github.com/lnreader/lnreader-plugins/issues/new';
    handleReaderLink(
      { url },
      {
        refresh: jest.fn(),
        openNovel: () => false,
        openExternal,
        inject: jest.fn(),
      },
      source,
    );
    expect(openExternal).toHaveBeenCalledWith(url);
  },
);
it.each(['', '_SELF', '_parent', '_top'])(
  'allows native in-place navigation for %s',
  target => {
    expect(
      handleReaderLink(
        { url: 'https://example.com', target },
        {
          refresh: jest.fn(),
          openNovel: () => false,
          openExternal: jest.fn(),
          inject: jest.fn(),
        },
        'native',
      ),
    ).toBe(true);
  },
);
