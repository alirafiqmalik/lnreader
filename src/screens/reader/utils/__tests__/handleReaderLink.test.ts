import { createReaderLinkHandlers } from '../handleReaderLink';
jest.mock('sanitize-html', () => ({
  __esModule: true,
  default: Object.assign(jest.fn(), { defaults: { allowedTags: ['p'] } }),
}));
const setup = (novel = false) => {
  const actions = {
    openNovel: jest.fn(() => novel),
    openExternal: jest.fn(),
    inject: jest.fn(),
    refresh: jest.fn(),
  };
  return { ...createReaderLinkHandlers(actions), actions };
};
it.each(['', '_SELF', '_parent', '_top'])(
  'loads same-window pages (%s)',
  target => {
    const h = setup();
    h.handlePage({ url: 'https://example.com', target });
    expect(h.actions.inject).toHaveBeenCalled();
    expect(h.shouldStartLoad('https://example.com')).toBe(true);
  },
);
it.each(['_blank', '_new', 'named'])(
  'opens window targets externally (%s)',
  target => {
    const h = setup();
    h.handlePage({ url: 'https://example.com', target });
    expect(h.actions.openExternal).toHaveBeenCalledWith('https://example.com');
  },
);
it('routes novel links from every entry point', () => {
  const h = setup(true);
  const url = 'https://royalroad.com/fiction/123';
  h.handlePage({ url, target: '_blank' });
  h.openWindow(url);
  expect(h.shouldStartLoad(url)).toBe(false);
  expect(h.actions.openNovel).toHaveBeenCalledTimes(3);
  expect(h.actions.openExternal).not.toHaveBeenCalled();
});
it('preserves native refresh and non-http navigation', () => {
  const h = setup();
  expect(h.shouldStartLoad('lnreader://refresh-chapter')).toBe(false);
  expect(h.actions.refresh).toHaveBeenCalledTimes(1);
  expect(h.shouldStartLoad('mailto:author@example.com')).toBe(true);
});
it.each(['about:blank', 'javascript:void(0)'])(
  'ignores non-navigation windows %s',
  url => {
    const h = setup();
    h.openWindow(url);
    expect(h.actions.openExternal).not.toHaveBeenCalled();
  },
);
it('opens plugin reports externally', () => {
  const h = setup();
  const url = 'https://github.com/lnreader/lnreader-plugins/issues/new';
  expect(h.shouldStartLoad(url)).toBe(false);
  expect(h.actions.openExternal).toHaveBeenCalledWith(url);
});
