import React from 'react';
import { screen, waitFor } from '@testing-library/react-native';
import { act, render, fireEvent } from '@test-utils';
import ReaderStack from '../ReaderStack';
import JumpToChapterModal from '@screens/novel/components/JumpToChapterModal';
import { NovelScreenProps } from '../types';
import { useNovelActions, useNovelValue } from '@screens/novel/NovelContext';
import { ChapterInfo, NovelInfo } from '@database/types';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockSwitch = jest.fn();
const mockNovel: NovelInfo = {
  id: 7,
  name: 'Novel',
  path: '/novel',
  pluginId: 'plugin',
  cover: null,
  inLibrary: true,
  isLocal: false,
  totalPages: 1,
};
const chapter: ChapterInfo = {
  id: 1,
  novelId: 7,
  path: '/chapter',
  name: 'Chapter',
  releaseTime: null,
  updatedTime: null,
  readTime: null,
  chapterNumber: 1,
  bookmark: false,
  progress: 0,
  timeSpent: 0,
  page: '1',
  unread: true,
  isDownloaded: false,
};
let mockChapters = [chapter];
let actions: ReturnType<typeof useNovelActions>;
let chapters: ChapterInfo[];
const mockRowUnmount = jest.fn();
let mockNavigate = jest.fn();
let mockShowJump = false;
jest.mock('@components', () => {
  const mockReact = require('react');
  const { View, Pressable, Text } = require('react-native');
  function Container({ children }: { children: React.ReactNode }) {
    return mockReact.createElement(View, null, children);
  }
  function Action({
    title,
    label,
    onPress,
  }: {
    title?: string;
    label?: string;
    onPress: () => void;
  }) {
    return mockReact.createElement(
      Pressable,
      { onPress },
      mockReact.createElement(Text, null, title ?? label),
    );
  }
  return {
    Dialog: {
      Root: Container,
      Header: Container,
      Title: Container,
      Description: Container,
      ScrollArea: Container,
      Actions: Container,
      Action,
    },
    SwitchItem: Action,
  };
});
jest.mock('@legendapp/list/react-native', () => ({
  LegendList: ({
    ListHeaderComponent,
  }: {
    ListHeaderComponent: React.ReactNode;
  }) => ListHeaderComponent,
}));
function ChapterRow() {
  React.useEffect(() => () => mockRowUnmount(), []);
  return null;
}
function MockProbe() {
  const currentActions = useNovelActions();
  const currentChapters = useNovelValue('chapters');
  React.useEffect(() => {
    actions = currentActions;
    chapters = currentChapters;
  }, [currentActions, currentChapters]);
  const loading = useNovelValue('loading');
  return loading ? null : (
    <>
      <ChapterRow />
      {mockShowJump && (
        <JumpToChapterModal
          hideModal={jest.fn()}
          modalVisible
          novel={mockNovel}
          chapterListRef={{ current: null }}
          navigation={
            {
              navigate: mockNavigate,
            } as unknown as NovelScreenProps['navigation']
          }
        />
      )}
    </>
  );
}
jest.mock('@screens/novel/NovelScreen', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@screens/reader/ReaderScreen', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: () => <MockProbe />,
    Screen: () => null,
  }),
}));
jest.mock('@components/Context/LibraryContext', () => ({
  useLibraryContext: () => ({ switchNovelToLibrary: mockSwitch }),
}));
jest.mock('@hooks/persisted', () => ({
  useAppSettings: () => ({ defaultChapterSort: 'ORDER BY id ASC' }),
  useTheme: () => ({ background: '#fff' }),
  useChapterReaderSettings: () => ({ theme: '#fff' }),
}));
const mockBootstrap = () => ({
  ok: true,
  novel: mockNovel,
  chapters: mockChapters,
  pages: ['1'],
  pageIndex: 0,
  batchInformation: {
    batch: 1,
    total: 1,
    totalChapters: mockChapters.length,
  },
  scanlators: [],
  firstUnreadChapter: mockChapters[0],
});
jest.mock('@hooks/persisted/useNovel/store-helper/bootstrapService', () => ({
  createBootstrapService: () => ({
    bootstrapNovelSync: () => mockBootstrap(),
    bootstrapNovelAsync: async () => mockBootstrap(),
  }),
}));
jest.mock('@hooks/persisted/useNovel/store-helper/persistence', () => ({
  novelPersistence: {
    readSettings: () => ({}),
    readPageIndex: () => 0,
    readLastRead: () => undefined,
    writeSettings: jest.fn(),
    writePageIndex: jest.fn(),
    writeLastRead: jest.fn(),
  },
}));
jest.mock('@database/queries/ChapterQueries', () => ({
  getNovelChaptersByNumber: jest.fn(async () => [chapter]),
  markChapterRead: jest.fn().mockResolvedValue(undefined),
  updateChapterProgress: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockChapters = [chapter];
  mockRowUnmount.mockClear();
  mockSwitch.mockClear();
  mockNavigate = jest.fn();
  mockShowJump = false;
  actions = undefined!;
  chapters = [];
});

it('retains loaded rows and reader mutations across Chapter navigation and Back', async () => {
  const initial = { screen: 'Novel', params: mockNovel };
  const view = render(<ReaderStack route={{ params: initial }} />, {
    wrapper: React.Fragment,
  });
  // Local Chapter navigation leaves the parent ReaderStack params unchanged.
  const originalActions = actions;
  const loadedRows = chapters;
  view.rerender(
    <ReaderStack
      route={{
        params: initial,
      }}
    />,
  );
  expect(actions).toBe(originalActions);
  expect(chapters).toBe(loadedRows);
  expect(mockRowUnmount).not.toHaveBeenCalled();
  act(() => {
    actions.updateChapterProgress(chapter.id, 65);
    actions.markChapterRead(chapter.id);
    actions.setLastRead(chapter);
  });
  view.rerender(<ReaderStack route={{ params: initial }} />);
  expect(chapters[0]).toMatchObject({ unread: false, progress: 65 });
  // Refresh/update reloads are retained as well, rather than overwritten by route seeds.
  mockChapters = [...chapters, { ...chapter, id: 2 }];
  await act(async () => {
    await actions.refreshNovel();
  });
  view.rerender(
    <ReaderStack
      route={{
        params: initial,
      }}
    />,
  );
  expect(chapters).toHaveLength(2);
  expect(chapters[0]).toMatchObject({ unread: false, progress: 65 });
});

it('bootstraps a Chapter-only stack opened from History', () => {
  render(
    <ReaderStack
      route={{
        params: { screen: 'Chapter', params: { novel: mockNovel, chapter } },
      }}
    />,
    { wrapper: React.Fragment },
  );
  expect(chapters).toHaveLength(mockChapters.length);
  expect(actions).toBeDefined();
});

it('keeps the parent params and store when the jump dialog opens a chapter', async () => {
  mockShowJump = true;
  const initial = { screen: 'Novel', params: mockNovel };
  let parentParams: typeof initial | { screen: string; params: unknown } =
    initial;
  const view = render(<ReaderStack route={{ params: parentParams }} />, {
    wrapper: React.Fragment,
  });
  const originalActions = actions;
  const originalRows = chapters;
  mockNavigate.mockImplementation((name: string, params: unknown) => {
    if (name === 'ReaderStack') parentParams = params as typeof parentParams;
    view.rerender(<ReaderStack route={{ params: parentParams }} />);
  });
  fireEvent.press(screen.getByText('Open Chapter'));
  const input = view.UNSAFE_getByType(require('react-native-paper').TextInput);
  fireEvent.changeText(input, '1');
  fireEvent(input, 'submitEditing');
  await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
  expect(mockNavigate).toHaveBeenCalledWith('Chapter', {
    novel: mockNovel,
    chapter,
  });
  expect(parentParams).toBe(initial);
  expect(actions).toBe(originalActions);
  expect(chapters).toBe(originalRows);
  expect(mockRowUnmount).not.toHaveBeenCalled();
});
