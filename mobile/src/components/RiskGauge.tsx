import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { theme } from '../utils/theme';

interface RiskGaugeProps {
  score?: number; // 0 to 1
  size?: number;
}

export const RiskGauge: React.FC<RiskGaugeProps> = ({ score = 0, size = 200 }) => {
  const strokeWidth = 15;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // Ensure score is a valid finite number, safely clamped between 0 and 1 (handles NaN, undefined, null)
  const normalizedScore = typeof score === 'number' && Number.isFinite(score) ? score : 0;
  const safeScore = Math.min(Math.max(normalizedScore, 0), 1);

  // Animated progress state for crash-proof pure react-native-svg rendering
  const [displayScore, setDisplayScore] = useState(0);
  const animRef = useRef(0);

  useEffect(() => {
    let animId: number;
    const start = animRef.current;
    const end = safeScore;
    const startTime = Date.now();
    const duration = 800;

    const animate = () => {
      const now = Date.now();
      const progress = Math.min((now - startTime) / duration, 1);
      // Ease-out cubic curve
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = start + (end - start) * ease;
      animRef.current = current;
      setDisplayScore(current);

      if (progress < 1) {
        animId = requestAnimationFrame(animate);
      }
    };

    animId = requestAnimationFrame(animate);
    return () => {
      if (animId) {
        cancelAnimationFrame(animId);
      }
    };
  }, [safeScore]);

  // Safe strokeDashoffset calculation:
  // strokeDashoffset = circumference * (1 - Math.min(Math.max(score, 0), 1))
  const strokeDashoffset = circumference * (1 - Math.min(Math.max(displayScore, 0), 1));

  let color = theme.colors.success;
  let label = 'GENUINE';
  if (safeScore >= 0.35) { color = theme.colors.warning; label = 'SUSPICIOUS'; }
  if (safeScore >= 0.50) { color = theme.colors.danger; label = 'SPOOFED'; }

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle
          stroke={theme.colors.surface}
          fill="none"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
        />
        <Circle
          stroke={color}
          fill="none"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={styles.textContainer}>
        <Text style={styles.topLabel}>DEEPFAKE RISK</Text>
        <Text style={styles.scoreText}>{Math.round(displayScore * 100)}%</Text>
        <View style={[styles.badgePill, { borderColor: color, backgroundColor: color + '20' }]}>
          <Text style={[styles.labelText, { color }]}>{label}</Text>
        </View>
        <Text style={styles.subConfidence}>
          {safeScore < 0.35
            ? `${Math.round((1 - displayScore) * 100)}% Authentic`
            : safeScore >= 0.50
            ? `${Math.round(displayScore * 100)}% Synthetic`
            : 'Suspicious / Inconclusive'}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  textContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topLabel: {
    color: '#8888aa',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 2,
  },
  scoreText: {
    color: theme.colors.textPrimary,
    fontSize: 34,
    fontWeight: 'bold',
  },
  badgePill: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 4,
  },
  labelText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  subConfidence: {
    color: '#00d4ff',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
});
