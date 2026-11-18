import React from 'react';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, act } from '@test-utils';
import WebViewReader from '../WebViewReader';
import WebView from 'react-native-webview';
import * as Linking from 'expo-linking';

const mockInject = jest.fn();
const mockOpenNovel = jest.fn(() => false);
const mockHidden = { current: false };
const mockSearch = { current: false };
const mockContext = {
  novel: { id: 1, pluginId: 'test' },
  chapter: { id: 1, name: 'Chapter' },
  chapterText: '<p>Chapter</p>',
  webViewRef: { current: { injectJavaScript: mockInject } },
  hiddenRef: mockHidden,
  isTTSReadingRef: { current: false },
  refetch: jest.fn(),
};
jest.mock('../../ChapterContext', () => ({
  useChapterContext: () => mockContext,
}));
jest.mock('../../hooks/useNovelLinkNavigation', () => ({
  __esModule: true,
  default: () => mockOpenNovel,
}));
jest.mock('../../hooks/useTtsSession', () => ({
  useTtsSession: () => ({
    state: 'idle',
    progress: { total: 0 },
    command: jest.fn(),
  }),
}));
jest.mock('../Hooks/useCustomCode', () => ({
  __esModule: true,
  default: () => ({ customJS: '', customCSS: '' }),
}));
jest.mock('../Hooks/useTextModifications', () => ({
  __esModule: true,
  default: () => ({ html: '<p>Chapter</p>', replaceModalVisible: false }),
}));
jest.mock('react-native-webview', () => {
  const mockReact = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: mockReact.forwardRef((props: object, _ref: unknown) =>
      mockReact.createElement(View, props),
    ),
  };
});
jest.mock('@plugins/pluginManager', () => ({
  getPlugin: () => ({ id: 'test', site: 'https://example.com' }),
}));
jest.mock('expo-linking', () => ({
  openURL: jest.fn(() => Promise.resolve()),
}));
jest.mock('sanitize-html', () => ({
  __esModule: true,
  default: Object.assign(jest.fn(), { defaults: { allowedTags: ['p'] } }),
}));

beforeEach(() => {
  mockInject.mockClear();
  mockOpenNovel.mockReset().mockReturnValue(false);
});
const mount = () =>
  render(
    <WebViewReader
      hiddenRef={mockHidden}
      searchVisibleRef={mockSearch}
      searchTextRef={{ current: '' }}
      onPress={jest.fn()}
      onSearchResult={jest.fn()}
    />,
    { wrapper: React.Fragment },
  );
it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  'restores current chrome refs on document load (%s %s)',
  (hidden, search) => {
    const view = mount();
    mockHidden.current = hidden;
    mockSearch.current = search;
    mockInject.mockClear();
    act(() => view.UNSAFE_getByType(WebView).props.onLoadEnd());
    const page = {
      reader: {
        hidden: { val: !(hidden || search) },
        batteryLevel: { val: 0 },
      },
    };
    for (const [script] of mockInject.mock.calls) {
      runInNewContext(script, { window: page });
    }
    expect(page.reader.hidden.val).toBe(hidden || search);
    const index = readFileSync(
      join(process.cwd(), 'assets/reader/js/index.js'),
      'utf8',
    );
    const toolWrapper = index.slice(
      index.indexOf('const ToolWrapper ='),
      index.indexOf('const ImageModal ='),
    );
    const className = runInNewContext(
      `${toolWrapper}; ToolWrapper().class();`,
      {
        reader: {
          ...page.reader,
          generalSettings: { val: { verticalSeekbar: false } },
        },
        van: { derive: (fn: () => boolean) => ({ val: fn() }) },
        div: (attributes: object) => attributes,
        Scrollbar: () => null,
      },
    );
    expect(className.trim()).toBe(
      hidden || search ? 'hidden horizontal' : 'horizontal',
    );
  },
);
it('routes page messages and native windows through novel navigation', () => {
  const view = mount();
  const props = view.UNSAFE_getByType(WebView).props;
  mockOpenNovel.mockReturnValue(true);
  const url = 'https://royalroad.com/fiction/123';
  act(() =>
    props.onMessage({
      nativeEvent: { data: JSON.stringify({ type: 'link', data: { url } }) },
    }),
  );
  expect(mockOpenNovel).toHaveBeenCalledWith(url);
  expect(props.onShouldStartLoadWithRequest({ url })).toBe(false);
  act(() => props.onOpenWindow({ nativeEvent: { targetUrl: url } }));
  expect(mockOpenNovel).toHaveBeenCalledTimes(3);
});
it('handles an external browser rejection', async () => {
  jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('unsupported'));
  const view = mount();
  await act(async () =>
    view
      .UNSAFE_getByType(WebView)
      .props.onOpenWindow({ nativeEvent: { targetUrl: 'unknown:example' } }),
  );
  expect(Linking.openURL).toHaveBeenCalledWith('unknown:example');
});

jest.mock('@hooks/persisted', () => ({
  useTheme: () => ({ surface: '#ffffff' }),
}));
jest.mock('@database/queries/NovelQueries');
jest.mock('@components/Context/LibraryContext', () => ({
  useLibraryContext: () => ({}),
}));
jest.mock('react-native/Libraries/EventEmitter/NativeEventEmitter', () => ({
  __esModule: true,
  default: class {
    addListener() {
      return { remove: jest.fn() };
    }
  },
}));
