import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle, TextStyle } from 'react-native';
import { theme } from '../utils/theme';

export type StatusLevel =
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'GENUINE'
  | 'SUSPICIOUS'
  | 'SPOOFED'
  | 'low'
  | 'medium'
  | 'high'
  | 'genuine'
  | 'suspicious'
  | 'spoofed';

export interface StatusBadgeProps {
  level: StatusLevel | string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
}

const getBadgeColor = (level?: string): string => {
  const norm = (level || '').trim().toUpperCase();
  switch (norm) {
    case 'HIGH':
    case 'SPOOFED':
    case 'CRITICAL':
    case 'DANGER':
      return theme.colors.danger;
    case 'MEDIUM':
    case 'SUSPICIOUS':
    case 'WARNING':
    case 'WARN':
    case 'MODERATE':
      return theme.colors.warning;
    case 'LOW':
    case 'GENUINE':
    case 'SAFE':
    case 'SUCCESS':
      return theme.colors.success;
    default:
      return theme.colors.success;
  }
};

const getDisplayText = (level?: string): string => {
  if (!level) return '';
  return level.trim().toUpperCase();
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  level,
  style,
  textStyle,
  testID,
}) => {
  const bgColor = getBadgeColor(level);
  const displayText = getDisplayText(level);

  return (
    <View style={[styles.badge, { backgroundColor: bgColor }, style]} testID={testID}>
      <Text style={[styles.text, textStyle]}>{displayText}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.full,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    color: '#000000',
    fontSize: theme.fontSizes.sm,
    fontWeight: 'bold',
  },
});


