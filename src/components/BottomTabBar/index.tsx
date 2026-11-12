import React from 'react';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Pressable, View, StyleSheet } from 'react-native';
import { Badge, Text } from 'react-native-paper';
import { ThemeColors } from '@theme/types';
import Animated from 'react-native-reanimated';
import Color from 'color';

interface CustomBottomTabBarProps extends BottomTabBarProps {
  theme: ThemeColors;
  showLabelsInNav: boolean;
  renderIcon: ({
    color,
    route,
  }: {
    route: { name: string };
    color: string;
  }) => React.ReactNode;
}

function CustomBottomTabBar({
  navigation,
  state,
  descriptors,
  insets,
  theme,
  showLabelsInNav,
  renderIcon,
}: CustomBottomTabBarProps) {
  const transparentBg = Color(theme.primaryContainer).fade(1).rgb().toString();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.surface2 || theme.surface,
          paddingBottom: 16 + (insets?.bottom || 0),
        },
      ]}
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const label =
          typeof options.tabBarLabel === 'string'
            ? options.tabBarLabel
            : options.title ?? route.name;
        const isFocused = state.index === index;
        const showLabel = (showLabelsInNav || isFocused) && label;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });

          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };

        const onLongPress = () => {
          navigation.emit({
            type: 'tabLongPress',
            target: route.key,
          });
        };

        const iconColor = isFocused
          ? theme.onPrimaryContainer
          : theme.onSurfaceVariant;

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: isFocused }}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
            testID={options.tabBarButtonTestID}
            onPress={onPress}
            onLongPress={onLongPress}
            style={styles.pressable}
          >
            {/* Icon */}
            <View
              style={[
                styles.iconContainer,
                { marginBottom: showLabel ? 4 : 20 },
              ]}
            >
              {/* The indicator is absolutely positioned and animated with a
                  transform so that growing it never re-runs layout, which
                  would otherwise make the icon and label tremble sideways as
                  their rounded pixel positions shift on every frame. */}
              <Animated.View
                style={[
                  styles.indicator,
                  {
                    transitionProperty: ['transform', 'backgroundColor'],
                    transitionDuration: 250,
                    transitionTimingFunction: 'ease-in-out',
                    transform: [{ scaleX: isFocused ? 1 : 0.5 }],
                    backgroundColor: isFocused
                      ? theme.primaryContainer
                      : transparentBg,
                  },
                ]}
              />
              {renderIcon({ color: iconColor, route })}
              {options.tabBarBadge != null ? (
                <Badge
                  style={[
                    styles.badge,
                    {
                      backgroundColor: theme.error,
                      color: theme.onError,
                    },
                    options.tabBarBadgeStyle,
                  ]}
                >
                  {options.tabBarBadge}
                </Badge>
              ) : null}
            </View>

            {/* Label */}
            {showLabel ? (
              <Text
                style={[
                  styles.label,
                  {
                    color: isFocused ? theme.onSurface : theme.onSurfaceVariant,
                    fontWeight: '500',
                  },
                ]}
                numberOfLines={1}
              >
                {label}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export default CustomBottomTabBar;
export type { CustomBottomTabBarProps };

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingTop: 12,
    paddingBottom: 16,
    paddingHorizontal: 0,
    minHeight: 80,
  },
  pressable: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    position: 'relative',
  },
  iconContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    width: 64,
    height: 32,
  },
  indicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: 4,
  },
  label: {
    height: 16,
    fontSize: 12,
    textAlign: 'center',
  },
});
