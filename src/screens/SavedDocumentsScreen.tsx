import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator,
  RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { formatMoney, formatDate, reviewStatusLabel } from '../utils/formatters';
import { getApiBaseUrl } from '../utils/apiConfig';
import type { SavedDocumentSummary } from '../types';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY } from '../theme/designSystem';

type Props = { navigation: any };

const API_BASE = getApiBaseUrl();

type FetchState = 'loading' | 'success' | 'error';

export function SavedDocumentsScreen({ navigation }: Props) {
  const [documents, setDocuments] = useState<SavedDocumentSummary[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { status: networkStatus } = useNetworkStatus();

  const fetchDocuments = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setFetchState('loading');
    setErrorMsg(null);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`${API_BASE.replace(/\/$/, '')}/documents?user_id=1`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const data = await response.json();
      const docs: SavedDocumentSummary[] = Array.isArray(data) ? data : (data.documents ?? []);
      // Sort newest first
      docs.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
      setDocuments(docs);
      setFetchState('success');
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Failed to load documents');
      setFetchState('error');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleRefresh = () => fetchDocuments(true);

  const handleRetry = () => fetchDocuments();

  const confidenceDot = (confidence: number | null) => {
    const color = confidence == null ? COLORS.textTertiary
      : confidence >= 0.8 ? COLORS.success
      : confidence >= 0.5 ? COLORS.warning
      : COLORS.error;
    return <View style={[styles.confidenceDot, { backgroundColor: color }]} />;
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, { bg: string; text: string }> = {
      unreviewed: { bg: COLORS.warningLight, text: COLORS.warningDark },
      needs_review: { bg: COLORS.warningLight, text: COLORS.warningDark },
      reviewed: { bg: COLORS.successLight, text: COLORS.successDark },
      corrected: { bg: '#DBEAFE', text: COLORS.primaryDark },
      approved: { bg: COLORS.successLight, text: COLORS.successDark },
    };
    const c = colors[status] ?? colors['unreviewed'];
    return (
      <View style={[styles.statusBadge, { backgroundColor: c.bg }]}>
        <Text style={[styles.statusBadgeText, { color: c.text }]}>{reviewStatusLabel(status)}</Text>
      </View>
    );
  };

  const renderItem = ({ item }: { item: SavedDocumentSummary }) => (
    <Pressable
      style={styles.docCard}
      onPress={() => {
        // Navigate to ResultScreen — reconstruct a minimal ExtractionResult
        navigation.navigate('Result', {
          result: {
            schema_version: '1.0',
            document_id: item.id,
            document: {
              type: 'invoice',
              invoice_number: item.invoice_number,
              date: item.date,
              time: null,
              currency: item.currency,
              language: 'en',
              prices_include_tax: null,
            },
            vendor: { name: item.vendor_name, branch: null, phone: null, email: null, gstin: null, fssai_number: null, address: { line1: null, line2: null, city: null, state: null, postal_code: null, country: 'India' } },
            transaction: { payment_method: null, expense_category: item.expense_category, notes: null },
            amounts: { subtotal: null, discount: '0.00', cgst: '0.00', sgst: '0.00', igst: '0.00', cess: '0.00', tax_total: '0.00', round_off: '0.00', grand_total: item.grand_total },
            line_items: [],
            files: { original_image_url: null, cropped_image_url: null, digital_copy_url: null, pdf_url: null },
            verification: { status: item.verification_status as any, corrected_by_user: false, reviewed_at: null, total_matches_items: null, tax_calculation_valid: null, duplicate_suspected: false, warnings: [] },
            ocr_metadata: { engine: null, overall_confidence: item.overall_confidence, processing_time_ms: null },
            raw_text: '',
            lines: [],
            confidence: item.overall_confidence,
            fields: [],
          },
          imageUri: '',
        });
      }}
    >
      <View style={styles.docCardTop}>
        <View style={styles.docCardLeft}>
          <Text style={styles.docVendor}>{item.vendor_name ?? 'Unknown Vendor'}</Text>
          <Text style={styles.docInvoice}>{item.invoice_number ?? 'No invoice #'}</Text>
        </View>
        <View style={styles.docCardRight}>
          <Text style={styles.docTotal}>{formatMoney(item.grand_total, item.currency)}</Text>
          <Text style={styles.docDate}>{formatDate(item.date)}</Text>
        </View>
      </View>
      <View style={styles.docCardBottom}>
        {confidenceDot(item.overall_confidence)}
        {statusBadge(item.verification_status)}
        {item.expense_category && (
          <View style={styles.categoryPill}>
            <Text style={styles.categoryPillText}>{item.expense_category}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );

  const renderEmpty = () => (
    <View style={styles.emptyState}>
      <Ionicons name="receipt-outline" size={64} color={COLORS.textTertiary} />
      <Text style={styles.emptyTitle}>No saved documents yet.</Text>
      <Text style={styles.emptySubtitle}>Scan your first receipt!</Text>
      <Pressable style={styles.emptyButton} onPress={() => navigation.getParent()?.navigate('Scan')}>
        <Ionicons name="scan-outline" size={18} color={COLORS.primary} />
        <Text style={styles.emptyButtonText}>Start Scanning</Text>
      </Pressable>
    </View>
  );

  const renderError = () => (
    <View style={styles.errorState}>
      <Ionicons name="cloud-offline-outline" size={56} color={COLORS.error} />
      <Text style={styles.errorTitle}>Failed to load documents</Text>
      <Text style={styles.errorSubtitle}>{errorMsg}</Text>
      <Pressable style={styles.retryButton} onPress={handleRetry}>
        <Text style={styles.retryButtonText}>Retry</Text>
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {networkStatus === 'offline' && (
        <View style={styles.offlineBanner}>
          <Ionicons name="wifi-outline" size={16} color={COLORS.warningDark} />
          <Text style={styles.offlineText}>You are offline. Showing cached data.</Text>
        </View>
      )}

      <View style={styles.screenHeader}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </Pressable>
        <Text style={styles.screenTitle}>Saved Documents</Text>
        <View style={{ width: 40 }} />
      </View>

      {fetchState === 'loading' && !refreshing ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading documents...</Text>
        </View>
      ) : fetchState === 'error' ? (
        renderError()
      ) : (
        <FlatList
          data={documents}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={documents.length === 0 ? styles.emptyList : styles.listContent}
          ListEmptyComponent={renderEmpty}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: COLORS.surface,
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: COLORS.textPrimary,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.warningLight,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  offlineText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.warningDark,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 15,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
    paddingBottom: 132,
  },
  emptyList: {
    flex: 1,
  },
  docCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
  docCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  docCardLeft: {
    flex: 1,
  },
  docCardRight: {
    alignItems: 'flex-end',
  },
  docVendor: {
    fontSize: 16,
    fontWeight: '900',
    color: COLORS.textPrimary,
  },
  docInvoice: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  docTotal: {
    fontSize: 18,
    fontWeight: '900',
    color: COLORS.textPrimary,
  },
  docDate: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  docCardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  confidenceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  categoryPill: {
    backgroundColor: COLORS.borderLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  categoryPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: COLORS.textPrimary,
    marginTop: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  emptyButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.primary,
  },
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 12,
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: COLORS.textPrimary,
    marginTop: 8,
  },
  errorSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  retryButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.textInverse,
  },
});
