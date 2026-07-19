import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Dimensions, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BarChart, PieChart } from 'react-native-chart-kit';
import { useAuth } from '../../context/AuthContext';
import { getApiBaseUrl } from '../../utils/apiConfig';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY } from '../../theme/designSystem';

const API_BASE = getApiBaseUrl();
type Period = 'daily' | 'weekly' | 'monthly' | 'yearly';

interface CategoryData { category: string; total: string; icon: string; color: string; }
interface DayData { date: string; total: string; count: number; }
interface VendorData { name: string; total: string; count: number; }
interface TaxBreakdown { cgst: string; sgst: string; igst: string; cess: string; }
interface Comparison { previous_period_total: string; percentage_change: number; trend: 'up' | 'down'; }
interface AnalyticsSummary {
  period: Period; total_expenses: string; expense_count: number; average_expense: string;
  by_category: CategoryData[]; by_day: DayData[]; top_vendors: VendorData[]; comparison: Comparison; tax_breakdown: TaxBreakdown;
}

const PERIODS: { label: string; value: Period }[] = [
  { label: 'Daily', value: 'daily' }, { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' }, { label: 'Yearly', value: 'yearly' },
];

const screenWidth = Dimensions.get('window').width;
const chartConfig = {
  backgroundColor: COLORS.surface, backgroundGradientFrom: COLORS.surface, backgroundGradientTo: COLORS.surface,
  decimalPlaces: 0, color: (opacity = 1) => `rgba(99, 102, 241, ${opacity})`,
  labelColor: () => COLORS.textSecondary, style: { borderRadius: RADIUS.md },
  barPercentage: 0.7,
};

export function AnalyticsScreen() {
  const { token } = useAuth();
  const [period, setPeriod] = useState<Period>('weekly');
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async (selectedPeriod: Period) => {
    try {
      setError(null);
      const response = await fetch(`${API_BASE}/analytics/summary?period=${selectedPeriod}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`Failed: ${response.status}`);
      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { setLoading(true); fetchAnalytics(period); }, [period, fetchAnalytics]);
  const onRefresh = useCallback(() => { setRefreshing(true); fetchAnalytics(period); }, [period, fetchAnalytics]);

  const formatCurrency = (value: string) => parseFloat(value).toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

  const getChartData = () => {
    if (!data?.by_day?.length) return null;
    const labels = data.by_day.map((d) => { const date = new Date(d.date); return `${date.getDate()}/${date.getMonth() + 1}`; });
    const values = data.by_day.map((d) => parseFloat(d.total));
    return { labels: labels.slice(-7), datasets: [{ data: values.slice(-7) }] };
  };

  const getPieData = () => {
    if (!data?.by_category?.length) return [];
    return data.by_category.map((cat, index) => ({
      name: cat.category, population: parseFloat(cat.total),
      color: cat.color || `#${Math.floor(Math.random() * 16777215).toString(16)}`,
      legendFontColor: COLORS.textSecondary, legendFontSize: 12,
    }));
  };

  if (loading) {
    return <View style={styles.loadingContainer}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="cloud-offline-outline" size={48} color={COLORS.error} />
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={() => fetchAnalytics(period)}><Text style={styles.retryButtonText}>Retry</Text></Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Analytics</Text>
      </View>

      {/* Period Selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.periodSelector}>
        {PERIODS.map((p) => (
          <Pressable key={p.value} style={[styles.periodChip, period === p.value && styles.periodChipActive]} onPress={() => setPeriod(p.value)}>
            <Text style={[styles.periodChipText, period === p.value && styles.periodChipTextActive]}>{p.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Summary Cards */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total Expenses</Text>
          <Text style={styles.summaryValue}>{formatCurrency(data?.total_expenses ?? '0')}</Text>
        </View>
        <View style={styles.summaryCardSmall}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Count</Text>
            <Text style={styles.summaryValueSmall}>{data?.expense_count ?? 0}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Average</Text>
            <Text style={styles.summaryValueSmall}>{formatCurrency(data?.average_expense ?? '0')}</Text>
          </View>
        </View>
      </View>

      {/* Comparison */}
      {data?.comparison && (
        <View style={[styles.comparisonCard, data.comparison.trend === 'up' ? styles.comparisonUp : styles.comparisonDown]}>
          <Ionicons name={data.comparison.trend === 'up' ? 'trending-up' : 'trending-down'} size={20} color={data.comparison.trend === 'up' ? COLORS.error : COLORS.success} />
          <Text style={styles.comparisonText}>
            {data.comparison.trend === 'up' ? '+' : ''}{data.comparison.percentage_change.toFixed(1)}% vs last period
          </Text>
        </View>
      )}

      {/* Bar Chart */}
      {getChartData() && (
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Spending Over Time</Text>
          <BarChart data={getChartData()!} width={screenWidth - SPACING.md * 4} height={200} chartConfig={chartConfig} style={styles.chart} showValuesOnTopOfBars yAxisLabel="₹" yAxisSuffix="" />
        </View>
      )}

      {/* Pie Chart */}
      {getPieData().length > 0 && (
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>By Category</Text>
          <PieChart data={getPieData()} width={screenWidth - SPACING.md * 4} height={200} chartConfig={chartConfig} accessor="population" backgroundColor="transparent" paddingLeft="15" />
        </View>
      )}

      {/* Top Vendors */}
      {data?.top_vendors && data.top_vendors.length > 0 && (
        <View style={styles.listCard}>
          <Text style={styles.chartTitle}>Top Vendors</Text>
          {data.top_vendors.slice(0, 5).map((vendor, index) => (
            <View key={index} style={styles.vendorRow}>
              <View style={styles.vendorLeft}>
                <Text style={styles.vendorRank}>#{index + 1}</Text>
                <Text style={styles.vendorName}>{vendor.name}</Text>
              </View>
              <Text style={styles.vendorTotal}>{formatCurrency(vendor.total)}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Tax Breakdown */}
      {data?.tax_breakdown && (
        <View style={styles.listCard}>
          <Text style={styles.chartTitle}>Tax Breakdown</Text>
          <View style={styles.taxRow}>
            {data.tax_breakdown.cgst && data.tax_breakdown.cgst !== '0' && <View style={styles.taxItem}><Text style={styles.taxLabel}>CGST</Text><Text style={styles.taxValue}>{formatCurrency(data.tax_breakdown.cgst)}</Text></View>}
            {data.tax_breakdown.sgst && data.tax_breakdown.sgst !== '0' && <View style={styles.taxItem}><Text style={styles.taxLabel}>SGST</Text><Text style={styles.taxValue}>{formatCurrency(data.tax_breakdown.sgst)}</Text></View>}
            {data.tax_breakdown.igst && data.tax_breakdown.igst !== '0' && <View style={styles.taxItem}><Text style={styles.taxLabel}>IGST</Text><Text style={styles.taxValue}>{formatCurrency(data.tax_breakdown.igst)}</Text></View>}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md, paddingBottom: 100 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { ...TYPOGRAPHY.body, color: COLORS.textSecondary, marginTop: SPACING.md },
  retryButton: { backgroundColor: COLORS.primary, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, borderRadius: RADIUS.md, marginTop: SPACING.md },
  retryButtonText: { ...TYPOGRAPHY.body, fontWeight: '600', color: COLORS.textInverse },
  header: { marginBottom: SPACING.md },
  headerTitle: { ...TYPOGRAPHY.h2, color: COLORS.textPrimary },
  periodSelector: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md },
  periodChip: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, borderRadius: RADIUS.full, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  periodChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  periodChipText: { ...TYPOGRAPHY.bodySmall, color: COLORS.textSecondary },
  periodChipTextActive: { color: COLORS.textInverse },
  summaryRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md },
  summaryCard: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  summaryCardSmall: { flex: 1, gap: SPACING.sm },
  summaryLabel: { ...TYPOGRAPHY.caption, color: COLORS.textSecondary, textTransform: 'uppercase' },
  summaryValue: { ...TYPOGRAPHY.h2, color: COLORS.primary, marginTop: SPACING.xs },
  summaryValueSmall: { ...TYPOGRAPHY.h4, color: COLORS.textPrimary, marginTop: SPACING.xs },
  comparisonCard: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  comparisonUp: { borderColor: COLORS.errorLight },
  comparisonDown: { borderColor: COLORS.successLight },
  comparisonText: { ...TYPOGRAPHY.bodySmall, color: COLORS.textSecondary },
  chartCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  chartTitle: { ...TYPOGRAPHY.h4, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  chart: { borderRadius: RADIUS.md, marginLeft: -SPACING.md },
  listCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  vendorRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  vendorLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  vendorRank: { ...TYPOGRAPHY.bodySmall, fontWeight: '700', color: COLORS.textTertiary, width: 24 },
  vendorName: { ...TYPOGRAPHY.body, color: COLORS.textPrimary },
  vendorTotal: { ...TYPOGRAPHY.body, fontWeight: '700', color: COLORS.textPrimary },
  taxRow: { flexDirection: 'row', gap: SPACING.md },
  taxItem: { flex: 1, backgroundColor: COLORS.borderLight, borderRadius: RADIUS.sm, padding: SPACING.sm, alignItems: 'center' },
  taxLabel: { ...TYPOGRAPHY.caption, color: COLORS.textSecondary },
  taxValue: { ...TYPOGRAPHY.body, fontWeight: '700', color: COLORS.textPrimary, marginTop: 2 },
});
