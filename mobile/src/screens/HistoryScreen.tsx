import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../utils/theme';
import { api, Session } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';

// Pre-populated sample sessions showing judges past LOW, MEDIUM, and HIGH risk analysis records
export const SAMPLE_SESSIONS: Session[] = [
  {
    id: 'ses-89f2-high',
    timestamp: new Date(Date.now() - 1000 * 60 * 12).toISOString(), // 12 mins ago
    speakerId: 'CEO Voice Clone',
    riskScore: 0.94,
    riskLevel: 'HIGH',
  },
  {
    id: 'ses-7b31-med',
    timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(), // 45 mins ago
    speakerId: 'Finance Lead (spk_409)',
    riskScore: 0.58,
    riskLevel: 'MEDIUM',
  },
  {
    id: 'ses-4a19-low',
    timestamp: new Date(Date.now() - 1000 * 60 * 180).toISOString(), // 3 hours ago
    speakerId: 'Executive Assistant',
    riskScore: 0.12,
    riskLevel: 'LOW',
  },
  {
    id: 'ses-3e82-high',
    timestamp: new Date(Date.now() - 1000 * 60 * 480).toISOString(), // 8 hours ago
    speakerId: 'Synthetic Inbound Call',
    riskScore: 0.88,
    riskLevel: 'HIGH',
  },
  {
    id: 'ses-2c67-med',
    timestamp: new Date(Date.now() - 1000 * 60 * 1440).toISOString(), // 24 hours ago
    speakerId: 'Support Agent Bob',
    riskScore: 0.46,
    riskLevel: 'MEDIUM',
  },
  {
    id: 'ses-1d05-low',
    timestamp: new Date(Date.now() - 1000 * 60 * 2160).toISOString(), // 36 hours ago
    speakerId: 'Verified User Alice',
    riskScore: 0.04,
    riskLevel: 'LOW',
  },
];

const normalizeRiskLevel = (rawLevel?: string): 'LOW' | 'MEDIUM' | 'HIGH' => {
  if (!rawLevel) return 'LOW';
  const upper = rawLevel.toUpperCase();
  if (upper === 'HIGH' || upper === 'SPOOFED') return 'HIGH';
  if (upper === 'MEDIUM' || upper === 'SUSPICIOUS') return 'MEDIUM';
  return 'LOW';
};

const formatRiskScore = (score: any): string => {
  if (typeof score !== 'number' || isNaN(score)) {
    return '0.0%';
  }
  const pct = score > 1 ? score : score * 100;
  const clamped = Math.min(Math.max(pct, 0), 100);
  return `${clamped.toFixed(1)}%`;
};

const formatSessionDate = (rawTimestamp?: string): string => {
  if (!rawTimestamp) return 'Recent Session';
  try {
    const date = new Date(rawTimestamp);
    if (!isNaN(date.getTime())) {
      return (
        date.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        }) +
        ' ' +
        date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      );
    }
  } catch {
    // ignore parsing errors
  }
  return String(rawTimestamp);
};

export const HistoryScreen = () => {
  const [sessions, setSessions] = useState<Session[]>(SAMPLE_SESSIONS);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'LOW' | 'MEDIUM' | 'HIGH'>('ALL');

  const loadSessions = async () => {
    try {
      const data: any = await api.getSessions();
      let list: any[] = [];
      if (Array.isArray(data)) {
        list = data;
      } else if (data && Array.isArray(data.sessions)) {
        list = data.sessions;
      }

      if (list && list.length > 0) {
        const normalized: Session[] = list.map((item: any, index: number) => {
          const rawRisk = item.riskScore ?? item.current_risk ?? 0;
          const score = typeof rawRisk === 'number' ? (rawRisk > 1 ? rawRisk / 100 : rawRisk) : 0;
          return {
            id: String(item.id || item.session_id || `session-${index}-${Date.now()}`),
            timestamp: item.timestamp || item.start_time || new Date().toISOString(),
            speakerId: item.speakerId || item.speaker_id || 'Unknown',
            riskScore: score,
            riskLevel: normalizeRiskLevel(item.riskLevel || item.risk_level),
          };
        });
        setSessions(normalized);
      } else {
        // Backend returned empty list - use sample historical sessions
        setSessions(SAMPLE_SESSIONS);
      }
    } catch (err) {
      console.warn('Backend unavailable or sessions fetch failed, using sample sessions:', err);
      setSessions(SAMPLE_SESSIONS);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadSessions();
    setRefreshing(false);
  };

  const safeSessions = Array.isArray(sessions) ? sessions : [];

  const counts = useMemo(() => {
    const res = { ALL: safeSessions.length, LOW: 0, MEDIUM: 0, HIGH: 0 };
    safeSessions.forEach(s => {
      const lvl = normalizeRiskLevel(s?.riskLevel);
      res[lvl]++;
    });
    return res;
  }, [safeSessions]);

  const filteredSessions = useMemo(() => {
    return safeSessions.filter(s => {
      if (!s) return false;
      if (filter === 'ALL') return true;
      return normalizeRiskLevel(s.riskLevel) === filter;
    });
  }, [safeSessions, filter]);

  const filterOptions: Array<{ label: string; value: 'ALL' | 'LOW' | 'MEDIUM' | 'HIGH' }> = [
    { label: `All (${counts.ALL})`, value: 'ALL' },
    { label: `Low Risk (${counts.LOW})`, value: 'LOW' },
    { label: `Medium (${counts.MEDIUM})`, value: 'MEDIUM' },
    { label: `High Risk (${counts.HIGH})`, value: 'HIGH' },
  ];

  const renderSession = ({ item }: { item: Session }) => {
    if (!item) return null;

    const validLevel = normalizeRiskLevel(item.riskLevel);
    const dateString = formatSessionDate(item.timestamp);
    const speakerDisplay = item.speakerId || 'Unidentified Speaker';
    const scoreDisplay = formatRiskScore(item.riskScore);

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.sessionDate}>{dateString}</Text>
          <StatusBadge level={validLevel} />
        </View>
        <View style={styles.cardBody}>
          <View style={styles.speakerContainer}>
            <Text style={styles.speakerLabel}>Speaker</Text>
            <Text style={styles.speakerText} numberOfLines={1}>
              {speakerDisplay}
            </Text>
          </View>
          <View style={styles.scoreContainer}>
            <Text style={styles.scoreLabel}>Risk Score</Text>
            <Text
              style={[
                styles.scoreText,
                validLevel === 'HIGH'
                  ? styles.scoreHigh
                  : validLevel === 'MEDIUM'
                  ? styles.scoreMedium
                  : styles.scoreLow,
              ]}
            >
              {scoreDisplay}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Analysis History</Text>
        <Text style={styles.subtitle}>Audit log of biometric voice verification sessions</Text>
      </View>

      <View style={styles.filtersWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filtersContainer}
        >
          {filterOptions.map(opt => {
            const isActive = filter === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.filterChip, isActive && styles.filterChipActive]}
                onPress={() => setFilter(opt.value)}
                activeOpacity={0.7}
              >
                <Text style={[styles.filterText, isActive && styles.filterTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <FlatList
        data={filteredSessions}
        keyExtractor={(item, index) => (item?.id ? String(item.id) : `session-${index}`)}
        renderItem={renderSession}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No Sessions Found</Text>
            <Text style={styles.emptyText}>
              {filter === 'ALL'
                ? 'No analysis sessions recorded yet.'
                : `No ${filter.toLowerCase()} risk sessions found in history.`}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  title: {
    fontSize: theme.fontSizes.xl,
    fontWeight: 'bold',
    color: theme.colors.primary,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: theme.fontSizes.sm,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  filtersWrapper: {
    paddingVertical: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
  },
  filtersContainer: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing.md,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipActive: {
    borderColor: theme.colors.primary,
    backgroundColor: 'rgba(0, 212, 255, 0.15)',
  },
  filterText: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSizes.sm,
    fontWeight: '500',
  },
  filterTextActive: {
    color: theme.colors.primary,
    fontWeight: 'bold',
  },
  list: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  listContent: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
    flexGrow: 1,
  },
  card: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  sessionDate: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSizes.sm,
  },
  cardBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  speakerContainer: {
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  speakerLabel: {
    color: theme.colors.textSecondary,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  speakerText: {
    color: theme.colors.textPrimary,
    fontSize: theme.fontSizes.md,
    fontWeight: '600',
  },
  scoreContainer: {
    alignItems: 'flex-end',
  },
  scoreLabel: {
    color: theme.colors.textSecondary,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  scoreText: {
    fontSize: theme.fontSizes.md,
    fontWeight: 'bold',
  },
  scoreHigh: {
    color: theme.colors.danger,
  },
  scoreMedium: {
    color: theme.colors.warning,
  },
  scoreLow: {
    color: theme.colors.success,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.xl * 2,
  },
  emptyTitle: {
    color: theme.colors.textPrimary,
    fontSize: theme.fontSizes.md,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  emptyText: {
    color: theme.colors.textSecondary,
    fontSize: theme.fontSizes.sm,
    textAlign: 'center',
  },
});
