import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, authFetch } from '../../context/AuthContext';
import { getApiBaseUrl } from '../../utils/apiConfig';
import { formatMoney, formatDate } from '../../utils/formatters';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY, SHADOWS, TOUCH } from '../../theme/designSystem';
import type { SavedDocumentSummary } from '../../types';
import type { RootStackParamList } from '../../types';
import type { StackNavigationProp } from '@react-navigation/stack';

type Period = 'daily' | 'weekly' | 'monthly' | 'yearly';

type AnalyticsSummary = {
  period: string;
  period_label: string;
  total_expenses: string;
  expense_count: number;
  average_expense: number;
  vendor_count: number;
  by_category: Array<{ category: string; count: number; total: string; icon?: string; color?: string }>;
  top_vendors: Array<{ name: string; count: number; total: string }>;
};

type FetchState = 'loading' | 'success' | 'error';

const API_BASE = getApiBaseUrl();

const PERIODS: { key: Period; label: string }[] = [
  { key: 'daily', label: 'Today' },
  { key: 'weekly', label: 'This Week' },
  { key: 'monthly', label: 'This Month' },
  { key: 'yearly', label: 'This Year' },
];

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  'Food & Dining': 'restaurant-outline',
  'Travel': 'airplane-outline',
  'Shopping': 'cart-outline',
  'Entertainment': 'film-outline',
  'Utilities': 'flash-outline',
  'Healthcare': 'medical-outline',
  'Education': 'school-outline',
  'Groceries': 'basket-outline',
  'Transport': 'car-outline',
  'Accommodation': 'bed-outline',
  'Uncategorized': 'receipt-outline',
};

const getCategoryIcon = (category: string | null): keyof typeof Ionicons.glyphMap => {
  return CATEGORY_ICONS[category ?? 'Uncategorized'] || 'receipt-outline';
};

type DashboardNavigationProp = StackNavigationProp<RootStackParamList>;
interface DashboardScreenProps {
  navigation: DashboardNavigationProp;
}

export function DashboardScreen({ navigation }: DashboardScreenProps) {
  const { user, isAuthenticated, refreshToken } = useAuth();

  const [selectedPeriod, setSelectedPeriod] = useState<Period>('monthly');
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [documents, setDocuments] = useState<SavedDocumentSummary[]>([]);
  const [summaryState, setSummaryState] = useState<FetchState>('loading');
  const [documentsState, setDocumentsState] = useState<FetchState>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const getGreeting = (): string => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const getUserName = (): string => {
    if (user?.full_name) return user.full_name.split(' ')[0];
    return 'there';
  };

  const fetchSummary = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setSummaryState('loading');
    setErrorMsg(null);
    try {
      const response = await authFetch(`/analytics/summary?period=${selectedPeriod}`, { method: 'GET' }, refreshToken);
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const data = await response.json();
      setSummary(data);
      setSummaryState('success');
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Failed to load analytics');
      setSummaryState('error');
    } finally {
      if (isRefresh) setRefreshing(false);
    }
  }, [selectedPeriod, refreshToken]);

  const fetchDocuments = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setDocumentsState('loading');
    try {
      const response = await authFetch(`/documents?limit=5`, { method: 'GET' }, refreshToken);
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const data = await response.json();
      const docs: SavedDocumentSummary[] = Array.isArray(data) ? data : (data.documents ?? []);
      docs.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
      setDocuments(docs);
      setDocumentsState('success');
    } catch (err: any) {
      setDocumentsState('error');
    } finally {
      if (isRefresh) setRefreshing(false);
    }
  }, [refreshToken]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

  const handlePeriodChange = (period: Period) => setSelectedPeriod(period);
  const handleRefresh = () => { fetchSummary(true); fetchDocuments(true); };
  const handleRetry = () => { fetchSummary(); fetchDocuments(); };

  const renderPeriodChips = () => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.periodChipsContainer}>
      {PERIODS.map((period) => (
        <Pressable
          key={period.key}
          style={[styles.periodChip, selectedPeriod === period.key && styles.periodChipActive]}
          onPress={() => handlePeriodChange(period.key)}
        >
          <Text style={[styles.periodChipText, selectedPeriod === period.key && styles.periodChipTextActive]}>
            {period.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );

  const renderSummaryCards = () => {
    if (summaryState === 'loading' && !summary) {
      return (
        <View style={styles.summaryLoading}>
          <ActivityIndicator color={COLORS.primary} size="small" />
        </View>
      );
    }

    if (summaryState === 'error' && !summary) {
      return (
        <View style={styles.summaryError}>
          <Text style={styles.summaryErrorText}>Unable to load summary</Text>
        </View>
      );
    }

    const totalExpenses = summary?.total_expenses ?? '0';
    const expenseCount = summary?.expense_count ?? 0;
    const averageExpense = summary?.average_expense ?? 0;

    return (
      <View style={styles.summaryCardsRow}>
        <View style={[styles.summaryCard, styles.summaryCardLarge]}>
          <Text style={styles.summaryCardLabel}>Total Expenses</Text>
          <Text style={styles.summaryCardValueLarge}>{formatMoney(totalExpenses, 'INR')}</Text>
        </View>
        <View style={styles.summaryCardSmallColumn}>
          <View style={styles.summaryCardSmall}>
            <Text style={styles.summaryCardLabel}>Count</Text>
            <Text style={styles.summaryCardValue}>{expenseCount}</Text>
          </View>
          <View style={styles.summaryCardSmall}>
            <Text style={styles.summaryCardLabel}>Average</Text>
            <Text style={styles.summaryCardValue}>{formatMoney(averageExpense, 'INR')}</Text>
          </View>
        </View>
      </View>
    );
  };

  const renderQuickActions = () => (
    <View style={styles.quickActionsRow}>
      <Pressable style={styles.quickActionBtn} onPress={() => navigation.navigate('AddManualExpense' as any)}>
        <Ionicons name="add-circle-outline" size={22} color={COLORS.primary} />
        <Text style={styles.quickActionText}>Add Expense</Text>
      </Pressable>
      <Pressable style={styles.quickActionBtn} onPress={() => navigation.getParent()?.navigate('Scan')}>
        <Ionicons name="scan-outline" size={22} color={COLORS.primary} />
        <Text style={styles.quickActionText}>Scan Receipt</Text>
      </Pressable>
    </View>
  );

  const renderDocumentItem = ({ item }: { item: SavedDocumentSummary }) => (
    <Pressable style={styles.docCard}>
      <View style={styles.docCardLeft}>
        <View style={styles.docIconContainer}>
          <Ionicons name={getCategoryIcon(item.expense_category)} size={20} color={COLORS.primary} />
        </View>
        <View style={styles.docInfo}>
          <Text style={styles.docVendor} numberOfLines={1}>{item.vendor_name ?? 'Unknown Vendor'}</Text>
          <Text style={styles.docDate}>{formatDate(item.date)}</Text>
        </View>
      </View>
      <View style={styles.docCardRight}>
        <Text style={styles.docAmount}>{formatMoney(item.grand_total, item.currency)}</Text>
        {item.expense_category && (
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryBadgeText}>{item.expense_category}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );

  const renderDocumentsList = () => {
    if (documentsState === 'loading' && documents.length === 0) {
      return (
        <View style={styles.documentsLoading}>
          <ActivityIndicator color={COLORS.primary} size="small" />
          <Text style={styles.loadingText}>Loading documents...</Text>
        </View>
      );
    }

    if (documentsState === 'error' && documents.length === 0) {
      return (
        <View style={styles.documentsError}>
          <Ionicons name="cloud-offline-outline" size={40} color={COLORS.error} />
          <Text style={styles.errorText}>Failed to load documents</Text>
          <Pressable style={styles.retryBtn} onPress={handleRetry}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      );
    }

    if (documents.length === 0) {
      return (
        <View style={styles.emptyDocuments}>
          <Ionicons name="receipt-outline" size={48} color={COLORS.textTertiary} />
          <Text style={styles.emptyTitle}>No documents yet</Text>
          <Text style={styles.emptySubtitle}>Scan your first receipt!</Text>
        </View>
      );
    }

    return (
      <FlatList
        data={documents}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderDocumentItem}
        scrollEnabled={false}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.sm }} />}
      />
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>{getGreeting()},</Text>
            <Text style={styles.userName}>{getUserName()}</Text>
          </View>
          <Pressable style={styles.avatar} onPress={() => navigation.getParent()?.navigate('Profile')}>
            {user?.full_name ? (
              <Text style={styles.avatarText}>
                {user.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
              </Text>
            ) : (
              <Ionicons name="person-outline" size={22} color={COLORS.primary} />
            )}
          </Pressable>
        </View>

        {/* Period Selector */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Overview</Text>
          {renderPeriodChips()}
        </View>

        {/* Summary Cards */}
        <View style={styles.section}>{renderSummaryCards()}</View>

        {/* Quick Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          {renderQuickActions()}
        </View>

        {/* Recent Documents */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Documents</Text>
            <Pressable onPress={() => navigation.getParent()?.navigate('Documents')}>
              <Text style={styles.seeAllText}>See all</Text>
            </Pressable>
          </View>
          {renderDocumentsList()}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { padding: SPACING.md, paddingBottom: 100 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg, paddingTop: SPACING.sm },
  greeting: { ...TYPOGRAPHY.body, color: COLORS.textSecondary, fontWeight: '500' },
  userName: { ...TYPOGRAPHY.h1, color: COLORS.textPrimary, marginTop: 2 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.primaryLight, borderWidth: 2, borderColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...TYPOGRAPHY.body, fontWeight: '900', color: COLORS.primary },
  section: { marginBottom: SPACING.lg },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
  sectionTitle: { ...TYPOGRAPHY.h4, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  seeAllText: { ...TYPOGRAPHY.bodySmall, fontWeight: '600', color: COLORS.primary, marginBottom: SPACING.sm },
  periodChipsContainer: { flexDirection: 'row', gap: SPACING.sm },
  periodChip: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.full, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  periodChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  periodChipText: { ...TYPOGRAPHY.bodySmall, fontWeight: '600', color: COLORS.textSecondary },
  periodChipTextActive: { color: COLORS.textInverse },
  summaryCardsRow: { flexDirection: 'row', gap: SPACING.sm },
  summaryCardLarge: { flex: 1.5 },
  summaryCardSmallColumn: { flex: 1, gap: SPACING.sm },
  summaryCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  summaryCardSmall: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.sm, borderWidth: 1, borderColor: COLORS.border },
  summaryCardLabel: { ...TYPOGRAPHY.caption, fontWeight: '600', color: COLORS.textSecondary, marginBottom: SPACING.xs, textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryCardValue: { ...TYPOGRAPHY.h3, color: COLORS.textPrimary },
  summaryCardValueLarge: { ...TYPOGRAPHY.h1, color: COLORS.primary },
  summaryLoading: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.lg, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  summaryError: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.lg, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  summaryErrorText: { ...TYPOGRAPHY.bodySmall, color: COLORS.textSecondary },
  quickActionsRow: { flexDirection: 'row', gap: SPACING.sm },
  quickActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingVertical: SPACING.md },
  quickActionText: { ...TYPOGRAPHY.bodySmall, fontWeight: '700', color: COLORS.primary },
  docCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  docCardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  docIconContainer: { width: 40, height: 40, borderRadius: RADIUS.sm, backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center', marginRight: SPACING.sm },
  docInfo: { flex: 1 },
  docVendor: { ...TYPOGRAPHY.body, fontWeight: '700', color: COLORS.textPrimary },
  docDate: { ...TYPOGRAPHY.caption, color: COLORS.textSecondary, marginTop: 2 },
  docCardRight: { alignItems: 'flex-end' },
  docAmount: { ...TYPOGRAPHY.body, fontWeight: '700', color: COLORS.textPrimary },
  categoryBadge: { backgroundColor: COLORS.borderLight, paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: RADIUS.sm, marginTop: 4 },
  categoryBadgeText: { ...TYPOGRAPHY.caption, fontWeight: '600', color: COLORS.textSecondary },
  documentsLoading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border },
  documentsError: { alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border, gap: SPACING.sm },
  errorText: { ...TYPOGRAPHY.bodySmall, color: COLORS.textSecondary, marginTop: 4 },
  retryBtn: { backgroundColor: COLORS.primary, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.sm, marginTop: SPACING.sm },
  retryBtnText: { ...TYPOGRAPHY.bodySmall, fontWeight: '700', color: COLORS.textInverse },
  emptyDocuments: { alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.xl, borderWidth: 1, borderColor: COLORS.border, gap: SPACING.sm },
  emptyTitle: { ...TYPOGRAPHY.h4, color: COLORS.textPrimary, marginTop: SPACING.sm },
  emptySubtitle: { ...TYPOGRAPHY.bodySmall, color: COLORS.textSecondary },
  loadingText: { ...TYPOGRAPHY.bodySmall, color: COLORS.textSecondary },
});
