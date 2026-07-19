import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator,
  RefreshControl, TextInput, ScrollView, Modal
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackScreenProps } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, authFetch } from '../../context/AuthContext';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useToast } from '../../hooks/useToast';
import { formatMoney, formatDate } from '../../utils/formatters';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY } from '../../theme/designSystem';
import type { RootStackParamList, SavedDocumentSummary } from '../../types';

type Props = StackScreenProps<RootStackParamList, 'DocumentsList'>;
type FetchState = 'loading' | 'success' | 'error';
type TimeFilter = 'all' | 'this_week' | 'this_month';

interface Category { id: number; name: string; }

export function DocumentsListScreen({ navigation }: Props) {
  const { user, refreshToken } = useAuth();
  const { status: networkStatus } = useNetworkStatus();
  const showToast = useToast();

  const [documents, setDocuments] = useState<SavedDocumentSummary[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);

  const fetchDocuments = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setFetchState('loading');
    setErrorMsg(null);

    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      if (selectedCategory) params.append('category', selectedCategory);
      params.append('limit', '50');

      const response = await authFetch(`/documents?${params.toString()}`, { method: 'GET' }, refreshToken);

      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const data = await response.json();
      let docs: SavedDocumentSummary[] = Array.isArray(data) ? data : (data.documents ?? []);

      if (timeFilter === 'this_week') {
        const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
        docs = docs.filter(d => d.date && new Date(d.date) >= weekAgo);
      } else if (timeFilter === 'this_month') {
        const monthStart = new Date(); monthStart.setDate(1);
        docs = docs.filter(d => d.date && new Date(d.date) >= monthStart);
      }

      docs.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
      setDocuments(docs);
      setFetchState('success');
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Failed to load documents');
      setFetchState('error');
    } finally {
      setRefreshing(false);
    }
  }, [searchQuery, timeFilter, selectedCategory, refreshToken]);

  const fetchCategories = useCallback(async () => {
    try {
      const response = await authFetch('/categories', { method: 'GET' }, refreshToken);
      if (response.ok) {
        const data = await response.json();
        setCategories(Array.isArray(data) ? data : (data.categories ?? []));
      }
    } catch { /* Silently fail */ }
  }, [refreshToken]);

  useEffect(() => { fetchDocuments(); fetchCategories(); }, [fetchDocuments, fetchCategories]);

  useEffect(() => {
    const debounceTimer = setTimeout(() => fetchDocuments(), 400);
    return () => clearTimeout(debounceTimer);
  }, [searchQuery]);

  const handleTimeFilterChange = (filter: TimeFilter) => { setTimeFilter(filter); setSelectedCategory(null); };
  const paymentMethodIcon = (method: string | null): keyof typeof Ionicons.glyphMap => {
    if (!method) return 'card-outline';
    const m = method.toLowerCase();
    if (m.includes('cash')) return 'cash-outline';
    if (m.includes('upi') || m.includes('google pay') || m.includes('phonepe')) return 'phone-portrait-outline';
    if (m.includes('card') || m.includes('credit') || m.includes('debit')) return 'card-outline';
    return 'card-outline';
  };

  const categoryBadgeColor = (category: string | null): string => {
    if (!category) return COLORS.borderLight;
    const c = category.toLowerCase();
    if (c.includes('food') || c.includes('dining')) return '#FEF3C7';
    if (c.includes('travel') || c.includes('fuel')) return '#DBEAFE';
    if (c.includes('medical')) return '#FCE7F3';
    if (c.includes('shop')) return '#E0E7FF';
    if (c.includes('utilities')) return '#D1FAE5';
    return COLORS.borderLight;
  };

  const categoryTextColor = (category: string | null): string => {
    if (!category) return COLORS.textSecondary;
    const c = category.toLowerCase();
    if (c.includes('food') || c.includes('dining')) return '#92400E';
    if (c.includes('travel') || c.includes('fuel')) return '#1E40AF';
    if (c.includes('medical')) return '#9D174D';
    if (c.includes('shop')) return '#3730A3';
    if (c.includes('utilities')) return '#065F46';
    return COLORS.textSecondary;
  };

  const renderItem = ({ item }: { item: SavedDocumentSummary }) => (
    <Pressable style={styles.docCard} onPress={() => navigation.navigate('DocumentDetail', { documentId: item.id })}>
      <View style={styles.docCardLeft}>
        <View style={styles.docIconContainer}>
          <Ionicons name="receipt-outline" size={20} color={COLORS.primary} />
        </View>
        <View style={styles.docInfo}>
          <Text style={styles.docVendor} numberOfLines={1}>{item.vendor_name ?? 'Unknown Vendor'}</Text>
          <Text style={styles.docDate}>{formatDate(item.date)}</Text>
        </View>
      </View>
      <View style={styles.docCardRight}>
        <Text style={styles.docAmount}>{formatMoney(item.grand_total, item.currency)}</Text>
        {item.expense_category && (
          <View style={[styles.categoryBadge, { backgroundColor: categoryBadgeColor(item.expense_category) }]}>
            <Text style={[styles.categoryBadgeText, { color: categoryTextColor(item.expense_category) }]}>{item.expense_category}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );

  const renderFilters = () => (
    <View style={styles.filtersContainer}>
      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={20} color={COLORS.textSecondary} />
        <TextInput style={styles.searchInput} placeholder="Search vendors..." placeholderTextColor={COLORS.textTertiary} value={searchQuery} onChangeText={setSearchQuery} />
        {searchQuery.length > 0 && <Pressable onPress={() => setSearchQuery('')}><Ionicons name="close-circle" size={20} color={COLORS.textSecondary} /></Pressable>}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChips}>
        {(['all', 'this_week', 'this_month'] as TimeFilter[]).map((filter) => (
          <Pressable key={filter} style={[styles.filterChip, timeFilter === filter && styles.filterChipActive]} onPress={() => handleTimeFilterChange(filter)}>
            <Text style={[styles.filterChipText, timeFilter === filter && styles.filterChipTextActive]}>
              {filter === 'all' ? 'All' : filter === 'this_week' ? 'This Week' : 'This Month'}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="document-text-outline" size={64} color={COLORS.textTertiary} />
      <Text style={styles.emptyTitle}>No documents found</Text>
      <Text style={styles.emptySubtitle}>{searchQuery ? 'Try a different search term' : 'Scan your first receipt to get started'}</Text>
    </View>
  );

  const renderError = () => (
    <View style={styles.errorContainer}>
      <Ionicons name="cloud-offline-outline" size={48} color={COLORS.error} />
      <Text style={styles.errorText}>{errorMsg ?? 'Something went wrong'}</Text>
      <Pressable style={styles.retryButton} onPress={() => fetchDocuments()}><Text style={styles.retryButtonText}>Retry</Text></Pressable>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Documents</Text>
        <Text style={styles.headerCount}>{documents.length} items</Text>
      </View>
      {renderFilters()}
      {fetchState === 'loading' && documents.length === 0 ? (
        <View style={styles.loadingContainer}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : fetchState === 'error' && documents.length === 0 ? (
        renderError()
      ) : (
        <FlatList
          data={documents}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={renderEmpty}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchDocuments(true)} tintColor={COLORS.primary} />}
          ItemSeparatorComponent={() => <View style={{ height: SPACING.sm }} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerTitle: { ...TYPOGRAPHY.h3, color: COLORS.textPrimary },
  headerCount: { ...TYPOGRAPHY.bodySmall, color: COLORS.textSecondary },
  filtersContainer: { padding: SPACING.md, gap: SPACING.sm },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, borderWidth: 1, borderColor: COLORS.border, gap: SPACING.sm },
  searchInput: { flex: 1, paddingVertical: SPACING.sm, ...TYPOGRAPHY.body },
  filterChips: { flexDirection: 'row', gap: SPACING.sm },
  filterChip: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, borderRadius: RADIUS.full, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  filterChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterChipText: { ...TYPOGRAPHY.bodySmall, color: COLORS.textSecondary },
  filterChipTextActive: { color: COLORS.textInverse },
  listContent: { paddingHorizontal: SPACING.md, paddingBottom: 100 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  docCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  docCardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  docIconContainer: { width: 40, height: 40, borderRadius: RADIUS.sm, backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center', marginRight: SPACING.sm },
  docInfo: { flex: 1 },
  docVendor: { ...TYPOGRAPHY.body, fontWeight: '700', color: COLORS.textPrimary },
  docDate: { ...TYPOGRAPHY.caption, color: COLORS.textSecondary, marginTop: 2 },
  docCardRight: { alignItems: 'flex-end' },
  docAmount: { ...TYPOGRAPHY.body, fontWeight: '700', color: COLORS.textPrimary },
  categoryBadge: { paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: RADIUS.sm, marginTop: 4 },
  categoryBadgeText: { ...TYPOGRAPHY.caption, fontWeight: '600' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },
  emptyTitle: { ...TYPOGRAPHY.h4, color: COLORS.textPrimary, marginTop: SPACING.md },
  emptySubtitle: { ...TYPOGRAPHY.body, color: COLORS.textSecondary, textAlign: 'center', marginTop: SPACING.sm },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },
  errorText: { ...TYPOGRAPHY.body, color: COLORS.textSecondary, marginTop: SPACING.md },
  retryButton: { backgroundColor: COLORS.primary, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, borderRadius: RADIUS.md, marginTop: SPACING.md },
  retryButtonText: { ...TYPOGRAPHY.body, fontWeight: '600', color: COLORS.textInverse },
});
