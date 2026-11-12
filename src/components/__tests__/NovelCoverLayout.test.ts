import './mocks';
import { renderHook } from '@test-utils';
import { useLibrarySettings } from '@hooks/persisted';
import { DisplayModes } from '@screens/library/constants/constants';
import { useNovelCoverLayoutValue } from '../NovelCoverLayoutContext';

let mockOrientation = 'portrait';
jest.mock('@hooks', () => ({
  useDeviceOrientation: () => mockOrientation,
}));

beforeEach(() => {
  mockOrientation = 'portrait';
  jest.mocked(useLibrarySettings).mockReturnValue({
    displayMode: DisplayModes.Comfortable,
    novelsPerRow: 4,
  } as ReturnType<typeof useLibrarySettings>);
});

it.each(['portrait', 'landscape'])(
  'keeps List mode full width in %s',
  orientation => {
    mockOrientation = orientation;
    jest.mocked(useLibrarySettings).mockReturnValue({
      displayMode: DisplayModes.List,
      novelsPerRow: 4,
    } as ReturnType<typeof useLibrarySettings>);
    const { result } = renderHook(() => useNovelCoverLayoutValue());
    expect(result.current.numColumns).toBe(1);
  },
);

it('preserves the chosen grid size in portrait', () => {
  const { result } = renderHook(() => useNovelCoverLayoutValue());
  expect(result.current.numColumns).toBe(4);
});

it('preserves the landscape grid and global search layouts', () => {
  mockOrientation = 'landscape';
  const { result } = renderHook(() => ({
    regular: useNovelCoverLayoutValue(),
    search: useNovelCoverLayoutValue(true),
  }));
  expect(result.current.regular.numColumns).toBe(6);
  expect(result.current.search.numColumns).toBe(3);
});
