import { act, renderHook, waitFor } from '@testing-library/react-native';

import { MMKVStorage } from '@utils/mmkv/mmkv';

import { useAppUpdateChecker } from '../useAppUpdateChecker';

jest.mock('@utils/mmkv/mmkv', () => ({
  MMKVStorage: {
    getNumber: jest.fn(),
    getString: jest.fn(),
    set: jest.fn(),
  },
}));

jest.mock('react-native-device-info', () => ({
  __esModule: true,
  default: {
    supportedAbis: jest.fn().mockResolvedValue(['arm64-v8a']),
    getBuildNumber: jest.fn(() => '100'),
  },
}));

const mockRelease = {
  tag_name: 'personal-101',
  body: 'Release notes',
  assets: [
    {
      name: 'LNReader-personal-101-arm64-v8a.apk',
      browser_download_url: 'https://example.com/lnreader.apk',
    },
  ],
};

const mockFetchRelease = () =>
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: jest.fn().mockResolvedValue(mockRelease),
  } as unknown as Response);

describe('useAppUpdateChecker', () => {
  beforeEach(() => {
    jest.mocked(MMKVStorage.getNumber).mockReturnValue(undefined);
    jest.mocked(MMKVStorage.getString).mockReturnValue(undefined);
  });

  it('reports a newer release that has not been ignored', async () => {
    mockFetchRelease();

    const { result } = renderHook(useAppUpdateChecker);

    await waitFor(() => expect(result.current.isNewVersion).toBe(true));
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/alirafiqmalik/lnreader/releases/latest',
    );
    expect(result.current.latestRelease).toEqual({
      tag_name: mockRelease.tag_name,
      body: mockRelease.body,
      downloadUrl: mockRelease.assets[0].browser_download_url,
    });
  });

  it('persists and immediately suppresses the ignored release', async () => {
    mockFetchRelease();

    const { result } = renderHook(useAppUpdateChecker);
    await waitFor(() => expect(result.current.isNewVersion).toBe(true));

    act(() => result.current.ignoreVersion(mockRelease.tag_name));

    expect(MMKVStorage.set).toHaveBeenCalledWith(
      'IGNORED_UPDATE_VERSION',
      mockRelease.tag_name,
    );
    expect(result.current.isNewVersion).toBe(false);
  });

  it('does not report a release that was ignored previously', async () => {
    jest.mocked(MMKVStorage.getString).mockReturnValue(mockRelease.tag_name);
    mockFetchRelease();

    const { result } = renderHook(useAppUpdateChecker);

    await waitFor(() => expect(result.current.latestRelease).toBeDefined());
    expect(result.current.isNewVersion).toBe(false);
  });

  it('reports a newer release after an older version was ignored', async () => {
    jest.mocked(MMKVStorage.getString).mockReturnValue('personal-99');
    mockFetchRelease();

    const { result } = renderHook(useAppUpdateChecker);

    await waitFor(() => expect(result.current.isNewVersion).toBe(true));
  });

  it.each(['personal-100', 'personal-99', 'v99.0.0', 'personal-invalid'])(
    'does not offer an installed, older, or unrelated release: %s',
    async tag => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ ...mockRelease, tag_name: tag }),
      } as unknown as Response);
      const { result } = renderHook(useAppUpdateChecker);
      await waitFor(() => expect(result.current.latestRelease).toBeDefined());
      expect(result.current.isNewVersion).toBe(false);
    },
  );
});
