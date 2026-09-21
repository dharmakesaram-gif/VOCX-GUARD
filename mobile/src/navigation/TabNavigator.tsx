import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../utils/theme';

// Screen imports supporting both named and default exports
import * as DashboardMod from '../screens/DashboardScreen';
import * as RecordAnalyzeMod from '../screens/RecordAnalyzeScreen';
import * as EnrollMod from '../screens/EnrollScreen';
import * as HistoryMod from '../screens/HistoryScreen';

// Type definitions for route parameters
export type TabParamList = {
  Dashboard: undefined;
  Analyze: undefined;
  Enroll: undefined;
  History: undefined;
};

// Helper to safely resolve screen components whether exported as named or default
const resolveScreen = (mod: any, namedKey: string): React.ComponentType<any> => {
  const Component = mod?.[namedKey] ?? mod?.default ?? mod;
  if (!Component || (typeof Component !== 'function' && typeof Component !== 'object')) {
    console.warn(`Screen ${namedKey} could not be resolved from module.`);
    return () => (
      <View style={styles.missingScreenContainer}>
        <Text style={styles.missingScreenText}>Screen {namedKey} unavailable</Text>
      </View>
    );
  }
  return Component;
};

// Safe viewport wrapper ensuring all screens fill the viewport cleanly
const withSafeViewport = (ScreenComponent: React.ComponentType<any>) => {
  const ComponentWithSafeViewport = (props: any) => (
    <View style={styles.screenViewport}>
      <ScreenComponent {...props} />
    </View>
  );
  ComponentWithSafeViewport.displayName = `SafeViewport(${
    ScreenComponent.displayName || ScreenComponent.name || 'Screen'
  })`;
  return ComponentWithSafeViewport;
};

// Resolve screens and wrap them with viewport-safe containers
const SafeDashboardScreen = withSafeViewport(resolveScreen(DashboardMod, 'DashboardScreen'));
const SafeRecordAnalyzeScreen = withSafeViewport(resolveScreen(RecordAnalyzeMod, 'RecordAnalyzeScreen'));
const SafeEnrollScreen = withSafeViewport(resolveScreen(EnrollMod, 'EnrollScreen'));
const SafeHistoryScreen = withSafeViewport(resolveScreen(HistoryMod, 'HistoryScreen'));

// Tab icon definitions with fallback emojis
interface TabIconConfig {
  focused: keyof typeof Ionicons.glyphMap;
  outline: keyof typeof Ionicons.glyphMap;
  emoji: string;
}

const TAB_ICONS: Record<string, TabIconConfig> = {
  Dashboard: {
    focused: 'home',
    outline: 'home-outline',
    emoji: '🏠',
  },
  Analyze: {
    focused: 'mic',
    outline: 'mic-outline',
    emoji: '🎙️',
  },
  Enroll: {
    focused: 'person-add',
    outline: 'person-add-outline',
    emoji: '👤',
  },
  History: {
    focused: 'time',
    outline: 'time-outline',
    emoji: '🕒',
  },
};

// Error boundary to catch native font / vector icon rendering errors
interface IconErrorBoundaryProps {
  fallback: React.ReactNode;
  children: React.ReactNode;
}

interface IconErrorBoundaryState {
  hasError: boolean;
}

class IconErrorBoundary extends React.Component<IconErrorBoundaryProps, IconErrorBoundaryState> {
  constructor(props: IconErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): IconErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('Ionicons render error caught in TabBarIcon, falling back to emoji:', error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// Component that renders Ionicons with error boundary and emoji fallback
const SafeTabBarIcon: React.FC<{
  routeName: string;
  focused: boolean;
  color: string;
  size: number;
}> = ({ routeName, focused, color, size }) => {
  const iconConfig = TAB_ICONS[routeName] || {
    focused: 'ellipse' as const,
    outline: 'ellipse-outline' as const,
    emoji: '●',
  };

  const iconName = focused ? iconConfig.focused : iconConfig.outline;

  const fallback = (
    <Text
      style={[
        styles.fallbackIcon,
        {
          fontSize: Math.max(size - 4, 16),
          color,
          lineHeight: size,
        },
      ]}
      accessibilityRole="image"
      accessibilityLabel={`${routeName} tab icon`}
    >
      {iconConfig.emoji}
    </Text>
  );

  try {
    return (
      <IconErrorBoundary fallback={fallback}>
        <Ionicons name={iconName} size={size} color={color} />
      </IconErrorBoundary>
    );
  } catch (err) {
    console.warn(`SafeTabBarIcon caught error for ${routeName}:`, err);
    return fallback;
  }
};

const Tab = createBottomTabNavigator<TabParamList>();

export const TabNavigator: React.FC = () => {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets?.bottom ?? 0, 0);

  const tabHeight = Platform.select({
    ios: 58 + bottomInset,
    android: 62 + bottomInset,
    default: 60 + bottomInset,
  });

  return (
    <Tab.Navigator
      sceneContainerStyle={styles.sceneContainer}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.colors.background,
          borderTopColor: theme.colors.surface,
          borderTopWidth: 1,
          elevation: 0,
          shadowOpacity: 0,
          height: tabHeight,
          paddingBottom: Math.max(bottomInset, 8),
          paddingTop: 8,
          position: 'relative',
          left: 0,
          right: 0,
          bottom: 0,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 2,
          marginBottom: Platform.OS === 'android' ? 4 : 0,
        },
        tabBarItemStyle: {
          justifyContent: 'center',
          alignItems: 'center',
          paddingVertical: 2,
        },
        tabBarIcon: ({ focused, color, size }) => {
          try {
            return (
              <SafeTabBarIcon
                routeName={route.name}
                focused={focused}
                color={color}
                size={size}
              />
            );
          } catch (error) {
            console.warn(`tabBarIcon fallback error for route ${route.name}:`, error);
            return (
              <Text style={[styles.fallbackIcon, { fontSize: 16, color }]}>
                ●
              </Text>
            );
          }
        },
      })}
    >
      <Tab.Screen
        name="Dashboard"
        component={SafeDashboardScreen}
        options={{ tabBarLabel: 'Dashboard' }}
      />
      <Tab.Screen
        name="Analyze"
        component={SafeRecordAnalyzeScreen}
        options={{ tabBarLabel: 'Analyze' }}
      />
      <Tab.Screen
        name="Enroll"
        component={SafeEnrollScreen}
        options={{ tabBarLabel: 'Enroll' }}
      />
      <Tab.Screen
        name="History"
        component={SafeHistoryScreen}
        options={{ tabBarLabel: 'History' }}
      />
    </Tab.Navigator>
  );
};

export default TabNavigator;

const styles = StyleSheet.create({
  sceneContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: theme.colors.background,
  },
  screenViewport: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: theme.colors.background,
  },
  fallbackIcon: {
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  missingScreenContainer: {
    flex: 1,
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.lg,
  },
  missingScreenText: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSizes.md,
  },
});
