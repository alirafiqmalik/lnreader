import './mocks';
import { Fragment } from 'react';
import { fireEvent, render, screen } from '@test-utils';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useTheme } from '@hooks/persisted';
import BottomTabBar from '../BottomTabBar';

const navigate = jest.fn();
const emit = jest.fn(() => ({ defaultPrevented: false }));
const routes = [
  { key: 'library', name: 'Library' },
  { key: 'browse', name: 'Browse' },
];

function Tabs({
  badge = '3',
  labels = false,
}: {
  badge?: string;
  labels?: boolean;
}) {
  const theme = useTheme();
  const props = {
    state: { index: 0, routes, routeNames: ['Library', 'Browse'] },
    descriptors: {
      library: { options: { title: 'My library' } },
      browse: {
        options: {
          title: 'Discover',
          tabBarAccessibilityLabel: 'Browse sources',
          tabBarBadge: badge || undefined,
          tabBarBadgeStyle: { backgroundColor: '#123456' },
        },
      },
    },
    navigation: { emit, navigate },
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
  } as unknown as BottomTabBarProps;
  return (
    <BottomTabBar
      {...props}
      theme={theme}
      showLabelsInNav={labels}
      renderIcon={() => null}
    />
  );
}

it('names every tab and announces selection when visual labels are hidden', () => {
  render(<Tabs />, { wrapper: Fragment });
  expect(
    screen.getByRole('tab', { name: 'My library', selected: true }),
  ).toBeTruthy();
  expect(
    screen.getByRole('tab', { name: 'Browse sources', selected: false }),
  ).toBeTruthy();
  expect(screen.queryByText('Discover')).toBeNull();
});

it('shows the configured update count and honors badge styling', () => {
  const { rerender } = render(<Tabs />, { wrapper: Fragment });
  expect(screen.getByText('3')).toHaveStyle({ backgroundColor: '#123456' });
  rerender(<Tabs badge="" labels />);
  expect(screen.queryByText('3')).toBeNull();
  expect(screen.getByText('Discover')).toBeTruthy();
});

it('preserves navigation, cancellation, and long press events', () => {
  render(<Tabs />, { wrapper: Fragment });
  const browse = screen.getByRole('tab', { name: 'Browse sources' });
  fireEvent.press(browse);
  expect(emit).toHaveBeenCalledWith({
    type: 'tabPress',
    target: 'browse',
    canPreventDefault: true,
  });
  expect(navigate).toHaveBeenCalledWith('Browse', undefined);
  navigate.mockClear();
  emit.mockReturnValueOnce({ defaultPrevented: true });
  fireEvent.press(browse);
  expect(navigate).not.toHaveBeenCalled();
  fireEvent(browse, 'longPress');
  expect(emit).toHaveBeenCalledWith({ type: 'tabLongPress', target: 'browse' });
  fireEvent.press(screen.getByRole('tab', { name: 'My library' }));
  expect(navigate).not.toHaveBeenCalled();
});
