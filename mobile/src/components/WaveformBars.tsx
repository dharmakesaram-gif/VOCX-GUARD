import React, { useEffect, useRef, Component } from 'react';
import {
  View,
  StyleSheet,
  Animated as RNAnimated,
  Easing as RNEasing,
  StyleProp,
  ViewStyle,
  DimensionValue,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import { theme } from '../utils/theme';

export interface WaveformBarsProps {
  isActive: boolean;
  barCount?: number;
  containerHeight?: number;
  containerWidth?: DimensionValue;
  barColor?: string;
  barWidth?: number;
  gap?: number;
  style?: StyleProp<ViewStyle>;
  useFallback?: boolean;
}

interface BarComponentProps {
  isActive: boolean;
  minHeight: number;
  maxHeight: number;
  barWidth: number;
  barColor: string;
  gap: number;
  index: number;
}

interface BarsListProps {
  count: number;
  isActive: boolean;
  minHeight: number;
  maxHeight: number;
  barWidth: number;
  barColor: string;
  gap: number;
}

// ---------------------------------------------------------------------------
// Error Boundary: catches Reanimated native/worklet failures and switches
// seamlessly to the pure React Native Animated fallback.
// ---------------------------------------------------------------------------
interface ErrorBoundaryProps {
  fallback: React.ReactNode;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class ReanimatedErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('[WaveformBars] Reanimated worklet failed, falling back to pure Animated:', error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// 1. Reanimated Implementation (Hardware-accelerated worklet animation)
// ---------------------------------------------------------------------------
const ReanimatedBar: React.FC<BarComponentProps> = React.memo(({
  isActive,
  minHeight,
  maxHeight,
  barWidth,
  barColor,
  gap,
}) => {
  const height = useSharedValue(minHeight);

  useEffect(() => {
    // Safely cancel any active animation before starting a new state transition
    cancelAnimation(height);

    if (isActive) {
      const randomDuration = Math.max(180, Math.floor(Math.random() * 260 + 200));
      const heightRange = maxHeight - minHeight;
      const randomPeak = Math.floor(Math.random() * heightRange * 0.75 + heightRange * 0.25 + minHeight);
      const clampedPeak = Math.min(Math.max(minHeight, randomPeak), maxHeight);

      // CRITICAL FIX FOR ANDROID WORKLETS:
      // When using withSequence inside withRepeat, reverse MUST be false.
      // Passing reverse=true with withSequence causes C++ worklet runtime crashes on Android Hermes
      // because withSequence already contains the forward and reverse transitions.
      height.value = withRepeat(
        withSequence(
          withTiming(clampedPeak, {
            duration: randomDuration,
            easing: Easing.inOut(Easing.ease),
          }),
          withTiming(minHeight, {
            duration: randomDuration,
            easing: Easing.inOut(Easing.ease),
          })
        ),
        -1, // Infinite repetition
        false // reverse = false ensures Android worklets do not throw or crash
      );
    } else {
      // Smoothly return to the idle minimum bar height
      height.value = withTiming(minHeight, {
        duration: 250,
        easing: Easing.out(Easing.ease),
      });
    }

    return () => {
      cancelAnimation(height);
    };
  }, [isActive, minHeight, maxHeight, height]);

  const animatedStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      // Strict clamping in worklet to prevent layout overflows
      height: Math.min(Math.max(height.value, minHeight), maxHeight),
    };
  });

  return (
    <Animated.View
      style={[
        styles.bar,
        {
          width: barWidth,
          backgroundColor: barColor,
          borderRadius: Math.floor(barWidth / 2),
          marginHorizontal: gap / 2,
        },
        animatedStyle,
      ]}
    />
  );
});

// ---------------------------------------------------------------------------
// 2. Pure React Native Animated Fallback Implementation
// ---------------------------------------------------------------------------
const PureAnimatedBar: React.FC<BarComponentProps> = React.memo(({
  isActive,
  minHeight,
  maxHeight,
  barWidth,
  barColor,
  gap,
}) => {
  const heightAnim = useRef(new RNAnimated.Value(minHeight)).current;
  const runningAnim = useRef<RNAnimated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (runningAnim.current) {
      runningAnim.current.stop();
      runningAnim.current = null;
    }

    if (isActive) {
      const duration = Math.max(180, Math.floor(Math.random() * 260 + 200));
      const heightRange = maxHeight - minHeight;
      const randomPeak = Math.floor(Math.random() * heightRange * 0.75 + heightRange * 0.25 + minHeight);
      const clampedPeak = Math.min(Math.max(minHeight, randomPeak), maxHeight);

      const loop = RNAnimated.loop(
        RNAnimated.sequence([
          RNAnimated.timing(heightAnim, {
            toValue: clampedPeak,
            duration,
            easing: RNEasing.inOut(RNEasing.ease),
            useNativeDriver: false,
          }),
          RNAnimated.timing(heightAnim, {
            toValue: minHeight,
            duration,
            easing: RNEasing.inOut(RNEasing.ease),
            useNativeDriver: false,
          }),
        ])
      );
      runningAnim.current = loop;
      loop.start();
    } else {
      const reset = RNAnimated.timing(heightAnim, {
        toValue: minHeight,
        duration: 250,
        easing: RNEasing.out(RNEasing.ease),
        useNativeDriver: false,
      });
      runningAnim.current = reset;
      reset.start();
    }

    return () => {
      if (runningAnim.current) {
        runningAnim.current.stop();
        runningAnim.current = null;
      }
    };
  }, [isActive, minHeight, maxHeight, heightAnim]);

  return (
    <RNAnimated.View
      style={[
        styles.bar,
        {
          width: barWidth,
          backgroundColor: barColor,
          borderRadius: Math.floor(barWidth / 2),
          marginHorizontal: gap / 2,
          height: heightAnim,
          maxHeight,
        },
      ]}
    />
  );
});

// ---------------------------------------------------------------------------
// Bar Lists
// ---------------------------------------------------------------------------
const ReanimatedBarsList: React.FC<BarsListProps> = ({
  count,
  isActive,
  minHeight,
  maxHeight,
  barWidth,
  barColor,
  gap,
}) => (
  <>
    {Array.from({ length: count }).map((_, i) => (
      <ReanimatedBar
        key={`reanimated-bar-${i}`}
        index={i}
        isActive={isActive}
        minHeight={minHeight}
        maxHeight={maxHeight}
        barWidth={barWidth}
        barColor={barColor}
        gap={gap}
      />
    ))}
  </>
);

const PureAnimatedBarsList: React.FC<BarsListProps> = ({
  count,
  isActive,
  minHeight,
  maxHeight,
  barWidth,
  barColor,
  gap,
}) => (
  <>
    {Array.from({ length: count }).map((_, i) => (
      <PureAnimatedBar
        key={`pure-bar-${i}`}
        index={i}
        isActive={isActive}
        minHeight={minHeight}
        maxHeight={maxHeight}
        barWidth={barWidth}
        barColor={barColor}
        gap={gap}
      />
    ))}
  </>
);

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export const WaveformBars: React.FC<WaveformBarsProps> = ({
  isActive,
  barCount = 25,
  containerHeight = 100,
  containerWidth = '100%',
  barColor = theme.colors.primary,
  barWidth = 5,
  gap = 4,
  style,
  useFallback = false,
}) => {
  // Clamp bar count within safe range
  const count = Math.max(1, Math.min(barCount, 60));
  // Guarantee bars stay strictly within container layout bounds
  const minBarHeight = 8;
  const maxBarHeight = Math.max(minBarHeight + 10, containerHeight - 20);

  const fallbackBars = (
    <PureAnimatedBarsList
      count={count}
      isActive={isActive}
      minHeight={minBarHeight}
      maxHeight={maxBarHeight}
      barWidth={barWidth}
      barColor={barColor}
      gap={gap}
    />
  );

  return (
    <View
      style={[
        styles.container,
        {
          height: containerHeight,
          width: containerWidth,
          maxHeight: containerHeight,
        },
        style,
      ]}
      accessibilityRole="image"
      accessibilityLabel={isActive ? 'Active audio recording waveform' : 'Idle audio recording waveform'}
    >
      {useFallback ? (
        fallbackBars
      ) : (
        <ReanimatedErrorBoundary fallback={fallbackBars}>
          <ReanimatedBarsList
            count={count}
            isActive={isActive}
            minHeight={minBarHeight}
            maxHeight={maxBarHeight}
            barWidth={barWidth}
            barColor={barColor}
            gap={gap}
          />
        </ReanimatedErrorBoundary>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: 100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  bar: {
    width: 5,
    backgroundColor: theme.colors.primary,
    borderRadius: 3,
  },
});
