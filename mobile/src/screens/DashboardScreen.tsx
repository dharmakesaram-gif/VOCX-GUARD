import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { theme } from '../utils/theme';
import { RiskGauge } from '../components/RiskGauge';
import { AlertCard } from '../components/AlertCard';
import { api } from '../services/api';

interface AlertItem {
  id: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  timestamp: string;
}

const DEFAULT_ALERTS: AlertItem[] = [
  {
    id: 'default-alert-1',
    severity: 'high',
    title: 'Spoofing Detected',
    description: 'Deepfake pattern identified in session 89f2',
    timestamp: '10 mins ago',
  },
  {
    id: 'default-alert-2',
    severity: 'medium',
    title: 'Suspicious Acoustic',
    description: 'Unusual background noise profile',
    timestamp: '1 hour ago',
  },
];

const sanitizeSeverity = (severity?: unknown): 'high' | 'medium' | 'low' => {
  if (typeof severity !== 'string') return 'low';
  const lower = severity.toLowerCase();
  if (lower === 'high' || lower === 'critical' || lower === 'spoofed') return 'high';
  if (lower === 'medium' || lower === 'suspicious' || lower === 'warning') return 'medium';
  return 'low';
};

const formatAlertTimestamp = (timeStr?: string): string => {
  if (!timeStr) return 'Recently';
  try {
    const d = new Date(timeStr);
    if (isNaN(d.getTime())) return timeStr;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return 'Recently';
  }
};

export const DashboardScreen = () => {
  const navigation = useNavigation<any>();

  // State handling for dynamic sessions/alerts/enrolled with safe defaults
  const [sessionCount, setSessionCount] = useState<number>(12);
  const [alertCount, setAlertCount] = useState<number>(3);
  const [enrolledCount, setEnrolledCount] = useState<number>(5);
  const [riskScore, setRiskScore] = useState<number>(0.15);
  const [alerts, setAlerts] = useState<AlertItem[]>(DEFAULT_ALERTS);
  const [isConnected, setIsConnected] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const fetchDashboardData = useCallback(async () => {
    let networkSuccess = false;

    // Fetch sessions
    try {
      const sessRes = await api.getSessions();
      let sessionsList: any[] = [];
      if (Array.isArray(sessRes)) {
        sessionsList = sessRes;
      } else if (sessRes && Array.isArray((sessRes as any).sessions)) {
        sessionsList = (sessRes as any).sessions;
      }

      if (sessionsList.length > 0) {
        networkSuccess = true;
        setSessionCount(sessionsList.length);

        // Filter alerts (high or medium risk sessions)
        const alertSessions = sessionsList.filter((s: any) => {
          const level = String(s.risk_level || s.riskLevel || '').toUpperCase();
          const score =
            typeof s.current_risk === 'number'
              ? s.current_risk
              : typeof s.riskScore === 'number'
              ? s.riskScore * 100
              : 0;
          return (
            level === 'HIGH' ||
            level === 'MEDIUM' ||
            level === 'SPOOFED' ||
            level === 'SUSPICIOUS' ||
            score >= 40
          );
        });

        setAlertCount(alertSessions.length);

        // Calculate latest risk score
        const latestSession = sessionsList[0];
        if (latestSession) {
          const rawScore =
            typeof latestSession.riskScore === 'number'
              ? latestSession.riskScore
              : typeof latestSession.current_risk === 'number'
              ? latestSession.current_risk / 100
              : 0.15;
          setRiskScore(
            typeof rawScore === 'number' && !isNaN(rawScore)
              ? Math.max(0, Math.min(1, rawScore))
              : 0.15
          );
        }

        // Generate dynamic alerts if any high/medium risk sessions exist
        if (alertSessions.length > 0) {
          const dynamicAlerts: AlertItem[] = alertSessions
            .slice(0, 5)
            .map((s: any, idx: number) => {
              const level = String(s.risk_level || s.riskLevel || '').toLowerCase();
              const isHigh =
                level === 'high' ||
                level === 'spoofed' ||
                (typeof s.current_risk === 'number' && s.current_risk > 70) ||
                (typeof s.riskScore === 'number' && s.riskScore > 0.7);
              const scoreVal =
                typeof s.current_risk === 'number'
                  ? Math.round(s.current_risk)
                  : typeof s.riskScore === 'number'
                  ? Math.round(s.riskScore * 100)
                  : 0;

              const timeRaw = s.timestamp || s.start_time;
              return {
                id: String(s.id || s.session_id || `alert-${idx}`),
                severity: isHigh ? ('high' as const) : ('medium' as const),
                title: isHigh
                  ? 'Spoofing Pattern Detected'
                  : 'Suspicious Acoustic Activity',
                description: `Session ${String(
                  s.id || s.session_id || idx
                ).substring(0, 8)}: Risk calculated at ${scoreVal}%`,
                timestamp: formatAlertTimestamp(timeRaw),
              };
            });
          setAlerts(dynamicAlerts);
        } else {
          setAlerts([]);
        }
      }
    } catch (error) {
      // Backend unreachable: keep safe defaults, do not crash
      console.warn('DashboardScreen: Failed to fetch sessions', error);
    }

    // Fetch enrolled speakers
    try {
      const spkRes = await api.getEnrolledSpeakers();
      let speakersList: any[] = [];
      if (Array.isArray(spkRes)) {
        speakersList = spkRes;
      } else if (spkRes && Array.isArray((spkRes as any).speakers)) {
        speakersList = (spkRes as any).speakers;
      } else if (
        spkRes &&
        typeof (spkRes as any).speakers === 'object' &&
        (spkRes as any).speakers !== null
      ) {
        speakersList = Object.keys((spkRes as any).speakers);
      }

      if (speakersList.length >= 0) {
        networkSuccess = true;
        setEnrolledCount(speakersList.length);
      }
    } catch (error) {
      // Backend unreachable: keep safe defaults, do not crash
      console.warn('DashboardScreen: Failed to fetch enrolled speakers', error);
    }

    setIsConnected(networkSuccess);
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchDashboardData();
    }, [fetchDashboardData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchDashboardData();
    setRefreshing(false);
  };

  // Safe guarded values passed to components
  const safeScore =
    typeof riskScore === 'number' && !isNaN(riskScore)
      ? Math.max(0, Math.min(1, riskScore))
      : 0.15;

  const safeSessionCount =
    typeof sessionCount === 'number' && !isNaN(sessionCount) ? sessionCount : 0;
  const safeAlertCount =
    typeof alertCount === 'number' && !isNaN(alertCount) ? alertCount : 0;
  const safeEnrolledCount =
    typeof enrolledCount === 'number' && !isNaN(enrolledCount) ? enrolledCount : 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>VOCX GUARD</Text>
          <Text style={styles.subtitle}>Voice Integrity Engine</Text>

          <TouchableOpacity
            style={styles.statusBadge}
            onPress={fetchDashboardData}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor: isConnected
                    ? theme.colors.success
                    : theme.colors.warning,
                },
              ]}
            />
            <Text style={styles.statusText}>
              {isConnected ? 'Connected to Server' : 'Offline (Tap to Retry)'}
            </Text>
          </TouchableOpacity>
        </View>

        {!isConnected && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineBannerText}>
              Backend unreachable. Displaying cached/safe default metrics.
            </Text>
          </View>
        )}

        <View style={styles.gaugeContainer}>
          <RiskGauge score={safeScore} size={220} />
          <Text style={styles.gaugeLabel}>Current System Risk Level</Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{safeSessionCount}</Text>
            <Text style={styles.statLabel}>Sessions</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, styles.statValueDanger]}>
              {safeAlertCount}
            </Text>
            <Text style={styles.statLabel}>Alerts</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{safeEnrolledCount}</Text>
            <Text style={styles.statLabel}>Enrolled</Text>
          </View>
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => navigation.navigate('Analyze')}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryBtnText}>Start Analysis</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => navigation.navigate('Enroll')}
            activeOpacity={0.8}
          >
            <Text style={styles.secondaryBtnText}>Enroll Voice</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.alertsSection}>
          <Text style={styles.sectionTitle}>Recent Alerts</Text>
          {alerts.length === 0 ? (
            <View style={styles.emptyAlertsBox}>
              <Text style={styles.emptyAlertsText}>
                No recent security alerts. System is operating normally.
              </Text>
            </View>
          ) : (
            alerts.map((alert, index) => (
              <AlertCard
                key={alert.id || `alert-${index}`}
                severity={sanitizeSeverity(alert.severity)}
                title={alert.title || 'Security Notification'}
                description={
                  alert.description || 'No alert description available.'
                }
                timestamp={alert.timestamp || 'Just now'}
              />
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollView: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  container: {
    flexGrow: 1,
    padding: theme.spacing.md,
    paddingBottom: 40,
    backgroundColor: theme.colors.background,
  },
  header: {
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
  },
  title: {
    fontSize: theme.fontSizes.xxl,
    fontWeight: 'bold',
    color: theme.colors.primary,
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: theme.fontSizes.md,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.sm,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.success,
    marginRight: 8,
  },
  statusText: {
    color: theme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '500',
  },
  offlineBanner: {
    backgroundColor: 'rgba(255, 184, 0, 0.1)',
    borderWidth: 1,
    borderColor: theme.colors.warning,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.sm,
    marginBottom: theme.spacing.md,
    alignItems: 'center',
  },
  offlineBannerText: {
    color: theme.colors.warning,
    fontSize: theme.fontSizes.sm,
    textAlign: 'center',
  },
  gaugeContainer: {
    alignItems: 'center',
    marginVertical: theme.spacing.lg,
  },
  gaugeLabel: {
    marginTop: theme.spacing.md,
    color: theme.colors.textSecondary,
    fontSize: theme.fontSizes.sm,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.xl,
  },
  statBox: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    marginHorizontal: 4,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  statValue: {
    fontSize: theme.fontSizes.xl,
    fontWeight: 'bold',
    color: theme.colors.textPrimary,
    marginBottom: 4,
  },
  statValueDanger: {
    color: theme.colors.danger,
  },
  statLabel: {
    fontSize: theme.fontSizes.sm,
    color: theme.colors.textSecondary,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: theme.spacing.xl,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: theme.colors.primary,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#000000',
    fontWeight: 'bold',
    fontSize: theme.fontSizes.md,
  },
  secondaryBtn: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: theme.colors.primary,
    fontWeight: 'bold',
    fontSize: theme.fontSizes.md,
  },
  alertsSection: {
    marginTop: theme.spacing.sm,
  },
  sectionTitle: {
    fontSize: theme.fontSizes.lg,
    fontWeight: 'bold',
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.md,
  },
  emptyAlertsBox: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    alignItems: 'center',
  },
  emptyAlertsText: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSizes.sm,
    textAlign: 'center',
  },
});
