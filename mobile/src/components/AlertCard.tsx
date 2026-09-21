import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { theme } from '../utils/theme';

export type AlertSeverity =
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

export interface AlertCardProps {
  severity: AlertSeverity | string;
  title: string;
  description: string;
  timestamp: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const getSeverityColor = (severity?: string): string => {
  const norm = (severity || '').trim().toUpperCase();
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
    default:
      return theme.colors.success;
  }
};

export const AlertCard: React.FC<AlertCardProps> = ({
  severity,
  title,
  description,
  timestamp,
  style,
  testID,
}) => {
  const borderColor = getSeverityColor(severity);

  return (
    <View style={[styles.card, { borderLeftColor: borderColor }, style]} testID={testID}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.timestamp}>{timestamp}</Text>
      </View>
      <Text style={styles.description}>{description}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderLeftWidth: 4,
    marginBottom: theme.spacing.sm,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.xs,
  },
  title: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: theme.fontSizes.md,
    fontWeight: 'bold',
    marginRight: theme.spacing.sm,
  },
  timestamp: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSizes.sm,
  },
  description: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSizes.sm,
    lineHeight: 18,
  },
});


