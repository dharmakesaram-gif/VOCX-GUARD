import React, { Component, ErrorInfo, ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  LogBox,
} from 'react-native';
import { NavigationContainer, DarkTheme, Theme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { TabNavigator } from './src/navigation/TabNavigator';
import { theme } from './src/utils/theme';

// Suppress non-critical development warnings for clean demo presentation
LogBox.ignoreAllLogs(true);

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[VocxGuard Root ErrorBoundary] Caught error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  resetError = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      const errorMessage =
        this.state.error?.message ||
        (typeof this.state.error === 'string' ? this.state.error : '') ||
        'An unexpected error occurred.';

      const componentStack = this.state.errorInfo?.componentStack || '';

      return (
        <SafeAreaView style={errorStyles.safeArea}>
          <StatusBar style="light" backgroundColor="#0a0a1a" />
          <View style={errorStyles.container}>
            <View style={errorStyles.iconContainer}>
              <Text style={errorStyles.icon}>⚠️</Text>
            </View>
            <Text style={errorStyles.title}>Application Error</Text>
            <Text style={errorStyles.subtitle}>
              VocxGuard encountered an unexpected issue.
            </Text>

            <View style={errorStyles.errorCard}>
              <ScrollView
                style={errorStyles.errorScrollView}
                contentContainerStyle={errorStyles.errorScrollContent}
              >
                <Text style={errorStyles.errorMessage}>{errorMessage}</Text>
                {componentStack ? (
                  <Text style={errorStyles.stackTrace}>
                    {componentStack.trim()}
                  </Text>
                ) : null}
              </ScrollView>
            </View>

            <TouchableOpacity
              style={errorStyles.button}
              onPress={this.resetError}
              activeOpacity={0.8}
            >
              <Text style={errorStyles.buttonText}>Restart App</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}

const errorStyles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0a0a1a',
  },
  container: {
    flex: 1,
    backgroundColor: '#0a0a1a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 59, 59, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  icon: {
    fontSize: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#00d4ff',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#999999',
    marginBottom: 20,
    textAlign: 'center',
  },
  errorCard: {
    width: '100%',
    maxHeight: 220,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 59, 59, 0.25)',
  },
  errorScrollView: {
    flexGrow: 0,
  },
  errorScrollContent: {
    paddingVertical: 4,
  },
  errorMessage: {
    fontSize: 14,
    color: '#ffb800',
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  stackTrace: {
    fontSize: 11,
    color: '#888888',
    fontFamily: 'monospace',
  },
  button: {
    backgroundColor: '#00d4ff',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#0a0a1a',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export const MyTheme: Theme = {
  dark: true,
  colors: {
    ...DarkTheme.colors,
    primary: theme?.colors?.primary || '#00d4ff',
    background: theme?.colors?.background || '#0a0a1a',
    card: theme?.colors?.surface || '#1a1a2e',
    text: theme?.colors?.textPrimary || '#ffffff',
    border: theme?.colors?.surface || '#1a1a2e',
    notification: theme?.colors?.danger || '#ff3b3b',
  },
};

export default function App() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider style={{ flex: 1, backgroundColor: '#0a0a1a' }}>
        <View style={{ flex: 1, backgroundColor: '#0a0a1a' }}>
          <NavigationContainer theme={MyTheme}>
            <StatusBar style="light" backgroundColor="#0a0a1a" />
            <TabNavigator />
          </NavigationContainer>
        </View>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
