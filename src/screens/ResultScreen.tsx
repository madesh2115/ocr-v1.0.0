import React, { useState } from 'react';
import {
  View, Text, Image, ScrollView, StyleSheet, Pressable, Share,
  TextInput, ActivityIndicator, Modal
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { ConfidenceBanner } from '../components/ConfidenceBanner';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { ImageZoomModal } from '../components/ImageZoomModal';
import { ValidationWarnings } from '../components/ValidationWarnings';
import { useToast } from '../hooks/useToast';
import { useAuth, authFetch } from '../context/AuthContext';
import { triggerHaptic } from '../hooks/useHaptics';
import { formatMoney, formatDate } from '../utils/formatters';
import { getApiBaseUrl } from '../utils/apiConfig';
import type { ExtractionResult, LineItem } from '../types';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY } from '../theme/designSystem';

type Props = { navigation: any; route: any };

const API_BASE = getApiBaseUrl();

const EXPENSE_CATEGORIES = [
  'Food & Dining', 'Travel', 'Shopping', 'Utilities', 'Medical',
  'Entertainment', 'Education', 'Office Supplies', 'Fuel', 'Other',
];

function EditableFieldRow({
  label,
  value,
  onChangeText,
  keyboardType = 'default',
  confidence,
  isMoney = false,
  currency = 'INR',
}: {
  label: string;
  value: string | number | null | undefined;
  onChangeText: (text: string) => void;
  keyboardType?: 'default' | 'numeric';
  confidence?: number | null;
  isMoney?: boolean;
  currency?: string;
}) {
  const displayValue = isMoney && value != null && value !== ''
    ? formatMoney(value, currency)
    : (value != null ? String(value) : '');
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput
          style={styles.input}
          value={displayValue}
          onChangeText={onChangeText}
          placeholder="Not found"
          placeholderTextColor={COLORS.textTertiary}
          keyboardType={keyboardType}
        />
        {confidence != null && (
          <Text style={[
            styles.confidencePill,
            confidence >= 0.7 ? styles.confidenceOk : styles.confidenceLow,
          ]}>
            {Math.round(confidence * 100)}%
          </Text>
        )}
      </View>
    </View>
  );
}

function VerificationBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; color: string; text: string }> = {
    unreviewed: { bg: COLORS.warningLight, color: COLORS.warningDark, text: 'Needs Review' },
    reviewed: { bg: COLORS.successLight, color: COLORS.successDark, text: 'Reviewed' },
    corrected: { bg: '#DBEAFE', color: COLORS.primaryDark, text: 'Corrected' },
    approved: { bg: COLORS.successLight, color: COLORS.successDark, text: 'Approved' },
  };
  const c = config[status] ?? config['unreviewed'];
  return (
    <View style={[styles.verificationBadge, { backgroundColor: c.bg }]}>
      <Text style={[styles.verificationBadgeText, { color: c.color }]}>{c.text}</Text>
    </View>
  );
}

function PricesIncludeTaxBadge({ value }: { value: 'yes' | 'no' | null | undefined }) {
  if (value == null) return null;
  if (value === 'yes') {
    return <View style={[styles.taxBadge, styles.taxBadgeGreen]}><Text style={styles.taxBadgeText}>Prices include GST</Text></View>;
  }
  return <View style={[styles.taxBadge, styles.taxBadgeAmber]}><Text style={styles.taxBadgeText}>Prices exclusive of GST</Text></View>;
}

function CategoryPickerModal({
  visible,
  current,
  onSelect,
  onClose,
}: {
  visible: boolean;
  current: string | null;
  onSelect: (cat: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View style={styles.categoryModal}>
          <Text style={styles.categoryModalTitle}>Select Category</Text>
          <ScrollView>
            {EXPENSE_CATEGORIES.map((cat) => (
              <Pressable
                key={cat}
                style={[styles.categoryOption, cat === current && styles.categoryOptionSelected]}
                onPress={() => { onSelect(cat); onClose(); }}
              >
                <Text style={[styles.categoryOptionText, cat === current && styles.categoryOptionTextSelected]}>
                  {cat}
                </Text>
                {cat === current && <Ionicons name="checkmark" size={18} color={COLORS.primary} />}
              </Pressable>
            ))}
          </ScrollView>
          <Pressable style={styles.categoryCancelBtn} onPress={onClose}>
            <Text style={styles.categoryCancelText}>Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

export function ResultScreen({ navigation, route }: Props) {
  const { result, imageUri } = route.params;
  const { refreshToken } = useAuth();
  const [zoomedImageUri, setZoomedImageUri] = useState<string | null>(null);
  const [editableResult, setEditableResult] = useState<ExtractionResult>({
    ...result,
    line_items: result.line_items || [],
  });
  const [isSaving, setIsSaving] = useState(false);
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const showToast = useToast();

  const currencyCode = editableResult.document?.currency ?? editableResult.currency ?? 'INR';
  const currencySymbol = currencyCode === 'INR' ? '₹' : currencyCode;
  const digitalReceiptUri = editableResult.digital_receipt_url ? `${API_BASE.replace(/\/$/, '')}${editableResult.digital_receipt_url}` : null;

  const handleShare = async () => {
    triggerHaptic('light');
    const text = formatResultForShare(editableResult);
    try {
      await Share.share({ message: text });
    } catch {
      showToast('Sharing failed', 'error');
    }
  };

  const handleNewScan = () => {
    triggerHaptic('medium');
    // Reset OCRStackNav back to ScanHome (the root of the scan flow)
    navigation.reset({ index: 0, routes: [{ name: 'ScanHome' }] });
  };

  const handleSave = async () => {
    if (!editableResult.document_id) {
      showToast('Document ID missing. Cannot save.', 'error');
      return;
    }
    setIsSaving(true);
    triggerHaptic('medium');
    try {
      const response = await authFetch(
        `/documents/${editableResult.document_id}/update`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(editableResult),
        },
        refreshToken
      );
      const data = await response.json();
      if (response.ok) {
        showToast('Document saved successfully!', 'success');
        triggerHaptic('success');
        navigation.reset({
          index: 0,
          routes: [{ name: 'SavedDocuments' }],
        });
      } else {
        showToast(data.error || 'Failed to save', 'error');
      }
    } catch (err: any) {
      showToast('Network error saving document', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const updateField = (key: keyof ExtractionResult, value: any) => {
    setEditableResult(prev => ({ ...prev, [key]: value }));
  };

  const updateNestedField = (section: 'document' | 'vendor' | 'amounts' | 'transaction', key: string, value: any) => {
    setEditableResult(prev => ({
      ...prev,
      [section]: { ...(prev[section] as any), [key]: value },
    }));
  };

  const updateLineItem = (index: number, key: keyof LineItem, val: string) => {
    const updatedItems = [...editableResult.line_items];
    updatedItems[index] = { ...updatedItems[index], [key]: val };
    updateField('line_items', updatedItems);
  };

  const addLineItem = () => {
    const newItem: LineItem = {
      id: null,
      name: '',
      description: null,
      hsn_code: null,
      quantity: '1.000',
      unit: 'item',
      unit_price: null,
      gross_amount: null,
      discount: '0.00',
      tax_rate: null,
      tax_amount: null,
      total: null,
      confidence: null,
      manually_corrected: false,
      item_name: '',
      text: null,
      rate: '',
      amount: null,
      gst: '',
      raw_text: null,
      learned: false,
    };
    const updatedItems = [...editableResult.line_items, newItem];
    updateField('line_items', updatedItems);
    triggerHaptic('light');
  };

  const deleteLineItem = (index: number) => {
    const updatedItems = editableResult.line_items.filter((_, idx) => idx !== index);
    updateField('line_items', updatedItems);
    triggerHaptic('warning');
  };

  const grandTotal = editableResult.amounts?.grand_total ?? editableResult.grand_total ?? editableResult.total ?? '0';
  const verificationStatus = editableResult.verification?.status ?? 'unreviewed';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <ScrollView contentContainerStyle={styles.screen}>
      <ConfidenceBanner confidence={editableResult.confidence ?? 0} />
      <ValidationWarnings validation={editableResult.validation} />

      {editableResult.database_error && (
        <View style={styles.dbErrorBanner}>
          <Ionicons name="server-outline" size={18} color={COLORS.errorDark} />
          <Text style={styles.dbErrorText}>
            Database error: {editableResult.database_error}. Document was processed but not saved.
          </Text>
        </View>
      )}

      {/* Header */}
      <View style={styles.headerRow}>
        <Pressable onPress={() => navigation.getParent()?.navigate('Scan')} style={styles.backBtn}>
          <Ionicons name="close" size={24} color={COLORS.textPrimary} />
        </Pressable>
        <View style={styles.headerLeft}>
          <Image source={require('../../assets/icon.png')} style={styles.logoTiny} />
          <View>
            <Text style={styles.headerTitle}>Extracted Data</Text>
            <Text style={styles.headerSubtitle}>{editableResult.document?.type ?? editableResult.document_type ?? 'Document'}</Text>
          </View>
        </View>
        <VerificationBadge status={verificationStatus} />
      </View>

      {imageUri && (
        <Pressable onPress={() => setZoomedImageUri(imageUri)}>
          <Image source={{ uri: imageUri }} style={styles.resultImage} />
          <View style={styles.zoomHint}>
            <Ionicons name="expand-outline" size={14} color={COLORS.textInverse} />
            <Text style={styles.zoomHintText}>Tap to zoom original</Text>
          </View>
        </Pressable>
      )}

      {digitalReceiptUri && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Digital Receipt</Text>
          <Pressable onPress={() => setZoomedImageUri(digitalReceiptUri)}>
            <Image source={{ uri: digitalReceiptUri }} style={styles.digitalReceiptImage} />
            <View style={styles.zoomHint}>
              <Ionicons name="expand-outline" size={14} color={COLORS.textInverse} />
              <Text style={styles.zoomHintText}>Tap to zoom receipt</Text>
            </View>
          </Pressable>
        </View>
      )}

      {/* Total Panel */}
      <View style={styles.totalPanel}>
        <Text style={styles.totalLabel}>TOTAL</Text>
        <Text style={styles.totalValue}>
          {formatMoney(grandTotal, currencyCode)}
        </Text>
        <Text style={styles.confidence}>Confidence {Math.round((editableResult.confidence ?? 0) * 100)}%</Text>
      </View>

      {/* ── Section 1: Document Info ─────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Document Info</Text>
        <EditableFieldRow label="Type" value={editableResult.document?.type} onChangeText={(v) => updateNestedField('document', 'type', v)} />
        <EditableFieldRow label="Invoice No." value={editableResult.document?.invoice_number ?? editableResult.invoice_number} onChangeText={(v) => updateNestedField('document', 'invoice_number', v)} />
        <EditableFieldRow label="Date" value={formatDate(editableResult.document?.date ?? editableResult.date)} onChangeText={(v) => updateNestedField('document', 'date', v)} />
        <EditableFieldRow label="Time" value={editableResult.document?.time} onChangeText={(v) => updateNestedField('document', 'time', v)} />
        <EditableFieldRow label="Currency" value={editableResult.document?.currency ?? editableResult.currency} onChangeText={(v) => updateNestedField('document', 'currency', v)} />
      </View>

      {/* ── Section 2: Vendor ─────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Vendor</Text>
        <EditableFieldRow
          label="Name"
          value={(editableResult.vendor as any)?.name ?? (typeof editableResult.vendor === 'string' ? editableResult.vendor : '')}
          confidence={editableResult.fields?.find(f => f.label === 'Vendor')?.confidence}
          onChangeText={(v) => updateNestedField('vendor', 'name', v)}
        />
        <EditableFieldRow
          label="Phone"
          value={editableResult.vendor?.phone ?? editableResult.phone}
          confidence={editableResult.fields?.find(f => f.label === 'Phone')?.confidence}
          onChangeText={(v) => updateNestedField('vendor', 'phone', v)}
        />
        <EditableFieldRow
          label="Email"
          value={editableResult.vendor?.email ?? editableResult.email}
          confidence={editableResult.fields?.find(f => f.label === 'Email')?.confidence}
          onChangeText={(v) => updateNestedField('vendor', 'email', v)}
        />
        <EditableFieldRow
          label="GSTIN"
          value={editableResult.vendor?.gstin ?? editableResult.tax_id}
          confidence={editableResult.fields?.find(f => f.label === 'GSTIN')?.confidence}
          onChangeText={(v) => updateNestedField('vendor', 'gstin', v)}
        />
        <EditableFieldRow
          label="Address"
          value={
            editableResult.vendor?.address
              ? [editableResult.vendor.address.line1, editableResult.vendor.address.line2, editableResult.vendor.address.city, editableResult.vendor.address.state, editableResult.vendor.address.postal_code]
                  .filter(Boolean).join(', ')
              : (editableResult.address ?? '')
          }
          onChangeText={(v) => updateNestedField('vendor', 'address', { line1: v, line2: null, city: null, state: null, postal_code: null, country: 'India' })}
        />
      </View>

      {/* ── Section 3: Amount Summary ─────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Amount Summary</Text>
          <PricesIncludeTaxBadge value={editableResult.document?.prices_include_tax} />
        </View>
        <EditableFieldRow label="Subtotal" value={editableResult.amounts?.subtotal ?? editableResult.subtotal} onChangeText={(v) => updateNestedField('amounts', 'subtotal', v)} isMoney currency={currencyCode} />
        <EditableFieldRow label="Discount" value={editableResult.amounts?.discount ?? '0.00'} onChangeText={(v) => updateNestedField('amounts', 'discount', v)} isMoney currency={currencyCode} />
        <EditableFieldRow label="CGST" value={editableResult.amounts?.cgst ?? editableResult.cgst} onChangeText={(v) => updateNestedField('amounts', 'cgst', v)} isMoney currency={currencyCode} />
        <EditableFieldRow label="SGST" value={editableResult.amounts?.sgst ?? editableResult.sgst} onChangeText={(v) => updateNestedField('amounts', 'sgst', v)} isMoney currency={currencyCode} />
        <EditableFieldRow label="IGST" value={editableResult.amounts?.igst ?? '0.00'} onChangeText={(v) => updateNestedField('amounts', 'igst', v)} isMoney currency={currencyCode} />
        <EditableFieldRow label="Cess" value={editableResult.amounts?.cess ?? editableResult.cess} onChangeText={(v) => updateNestedField('amounts', 'cess', v)} isMoney currency={currencyCode} />
        <EditableFieldRow label="Round Off" value={editableResult.amounts?.round_off ?? editableResult.round_off} onChangeText={(v) => updateNestedField('amounts', 'round_off', v)} isMoney currency={currencyCode} />
        <EditableFieldRow label="Grand Total" value={editableResult.amounts?.grand_total ?? editableResult.grand_total ?? grandTotal} onChangeText={(v) => updateNestedField('amounts', 'grand_total', v)} isMoney currency={currencyCode} />
      </View>

      {/* ── Section 4: Transaction ─────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Transaction</Text>
        <EditableFieldRow label="Payment" value={editableResult.transaction?.payment_method ?? editableResult.payment_method} onChangeText={(v) => updateNestedField('transaction', 'payment_method', v)} />
        <View style={styles.row}>
          <Text style={styles.label}>Expense Category</Text>
          <Pressable style={styles.categoryTrigger} onPress={() => setCategoryModalVisible(true)}>
            <Text style={[
              styles.categoryTriggerText,
              !(editableResult.transaction?.expense_category) && styles.categoryTriggerPlaceholder,
            ]}>
              {editableResult.transaction?.expense_category ?? 'Select category'}
            </Text>
            <Ionicons name="chevron-down" size={16} color={COLORS.textSecondary} />
          </Pressable>
        </View>
        <CategoryPickerModal
          visible={categoryModalVisible}
          current={editableResult.transaction?.expense_category ?? null}
          onSelect={(cat) => {
            triggerHaptic('light');
            updateNestedField('transaction', 'expense_category', cat);
          }}
          onClose={() => setCategoryModalVisible(false)}
        />
      </View>

      {/* ── Section 5: Line Items ─────────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Line Items</Text>
          <Pressable style={styles.addButton} onPress={addLineItem}>
            <Ionicons name="add" size={16} color={COLORS.primary} />
            <Text style={styles.addButtonText}>Add Item</Text>
          </Pressable>
        </View>

        {editableResult.line_items.length > 0 ? (
          <>
            <View style={styles.itemHeader}>
              <Text style={[styles.itemHeadText, styles.itemNameCol]}>Item</Text>
              <Text style={styles.itemHeadText}>Unit Price</Text>
              <Text style={styles.itemHeadText}>Qty</Text>
              <Text style={styles.itemHeadText}>Total</Text>
              <Text style={styles.itemHeadText}>GST</Text>
              <Text style={styles.itemHeadText}></Text>
            </View>
            {editableResult.line_items.map((item, index) => {
              const totalsMatch = item.totals_match;
              const isProblem = totalsMatch === 'validation_error' || totalsMatch === 'approximate';
              // Inferred quantity: qty is "1.000" and total === unit_price (no explicit qty in OCR)
              const qtyNum = parseFloat(item.quantity ?? '0');
              const unitPriceNum = parseFloat(item.unit_price ?? item.rate ?? '0');
              const totalNum = parseFloat(item.total ?? item.amount ?? '0');
              const qtyInferred = qtyNum === 1 && Math.abs(totalNum - unitPriceNum) < 0.01;
              return (
                <View key={index} style={styles.itemRow}>
                  <View style={[styles.itemInput, styles.itemNameCol, isProblem && totalsMatch === 'validation_error' && styles.itemRowError]}>
                    <TextInput
                      style={{ flex: 1, fontSize: 12, fontWeight: '800', color: COLORS.textPrimary, padding: 0 }}
                      value={item.name || item.item_name || item.text || ''}
                      onChangeText={(val) => updateLineItem(index, 'name', val)}
                      placeholder="Item Name"
                      placeholderTextColor={COLORS.textTertiary}
                    />
                    {isProblem && (
                      <Ionicons
                        name={totalsMatch === 'validation_error' ? 'alert-circle' : 'warning'}
                        size={12}
                        color={totalsMatch === 'validation_error' ? COLORS.error : COLORS.warning}
                      />
                    )}
                  </View>
                  <TextInput
                    style={[styles.itemInput, styles.itemNumCol]}
                    value={item.unit_price ?? item.rate ?? ''}
                    onChangeText={(val) => updateLineItem(index, 'unit_price', val)}
                    placeholder="Price"
                    placeholderTextColor={COLORS.textTertiary}
                    keyboardType="numeric"
                  />
                  <View style={[styles.itemInput, styles.itemNumCol]}>
                    <TextInput
                      style={{ flex: 1, fontSize: 12, fontWeight: '800', color: COLORS.textPrimary, textAlign: 'center', padding: 0 }}
                      value={item.quantity || ''}
                      onChangeText={(val) => updateLineItem(index, 'quantity', val)}
                      placeholder="1"
                      placeholderTextColor={COLORS.textTertiary}
                      keyboardType="numeric"
                    />
                    {qtyInferred && (
                      <Text style={styles.inferredQty}>?</Text>
                    )}
                  </View>
                  <TextInput
                    style={[styles.itemInput, styles.itemNumCol]}
                    value={item.total ?? item.amount ?? ''}
                    onChangeText={(val) => updateLineItem(index, 'total', val)}
                    placeholder="Total"
                    placeholderTextColor={COLORS.textTertiary}
                    keyboardType="numeric"
                  />
                  <TextInput
                    style={[styles.itemInput, styles.itemNumCol]}
                    value={item.gst ?? item.tax_rate ?? ''}
                    onChangeText={(val) => updateLineItem(index, 'gst', val)}
                    placeholder="GST"
                    placeholderTextColor={COLORS.textTertiary}
                  />
                  <Pressable onPress={() => deleteLineItem(index)} style={styles.deleteButton}>
                    <Ionicons name="trash-outline" size={16} color={COLORS.error} />
                  </Pressable>
                </View>
              );
            })}
          </>
        ) : (
          <Text style={styles.muted}>No line items detected.</Text>
        )}
      </View>

      {/* ── Section 6: Raw OCR Text ─────────────────────────────────────────── */}
      <CollapsibleSection title="Raw OCR Text" defaultExpanded={(editableResult.raw_text?.length ?? 0) < 300}>
        <Text style={styles.rawText}>{editableResult.raw_text || 'No OCR text returned.'}</Text>
      </CollapsibleSection>

      {/* ── Action Buttons ─────────────────────────────────────────────────── */}
      <PrimaryButton
        icon="save-outline"
        label={isSaving ? "Saving changes..." : "Save Changes"}
        onPress={handleSave}
        disabled={isSaving}
      />

      <View style={styles.actionGrid}>
        <SecondaryButton icon="arrow-back-outline" label="Edit Scan" onPress={() => navigation.goBack()} />
        <SecondaryButton icon="share-outline" label="Share" onPress={handleShare} />
        <SecondaryButton icon="add-circle-outline" label="New Scan" onPress={handleNewScan} />
      </View>

      <ImageZoomModal
        visible={!!zoomedImageUri}
        imageUri={zoomedImageUri}
        onClose={() => setZoomedImageUri(null)}
      />
      </ScrollView>
    </SafeAreaView>
  );
}

function formatResultForShare(result: ExtractionResult): string {
  const vendorRaw: any = result.vendor;
  const vendorName = vendorRaw?.name ?? (typeof vendorRaw === 'string' ? vendorRaw : 'Unknown');
  const date = result.document?.date ?? result.date ?? 'N/A';
  const invoice = result.document?.invoice_number ?? result.invoice_number ?? 'N/A';
  const currencySymbol = result.document?.currency === 'INR' ? '₹' : (result.currency ?? '');
  const grandTotal = result.amounts?.grand_total ?? result.grand_total ?? result.total ?? 'N/A';
  const lines = [
    `Bill: ${vendorName}`,
    `Date: ${date}`,
    `Invoice: ${invoice}`,
    `Total: ${currencySymbol}${grandTotal}`,
    result.amounts?.subtotal ? `Subtotal: ${currencySymbol}${result.amounts.subtotal}` : null,
    result.transaction?.payment_method ? `Payment: ${result.transaction.payment_method}` : null,
    '',
    result.line_items.length > 0 ? 'Line Items:' : null,
    ...result.line_items.map((item) =>
      item.name || item.item_name ? `${item.name ?? item.item_name} x${item.quantity || 1} = ${item.total || item.amount || '-'}` : null
    ),
  ].filter(Boolean) as string[];
  return lines.join('\n');
}

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    gap: 14,
    padding: 18,
    backgroundColor: COLORS.background,
    paddingBottom: 100,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoTiny: {
    width: 42,
    height: 42,
    borderRadius: 10,
  },
  headerTitle: {
    color: COLORS.textPrimary,
    fontSize: 22,
    fontWeight: '900',
  },
  headerSubtitle: {
    color: COLORS.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  verificationBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  verificationBadgeText: {
    fontSize: 12,
    fontWeight: '800',
  },
  dbErrorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: COLORS.errorLight,
    borderColor: COLORS.error,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  dbErrorText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.errorDark,
    fontWeight: '600',
    lineHeight: 18,
  },
  resultImage: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 12,
    resizeMode: 'contain',
  },
  digitalReceiptImage: {
    width: '100%',
    aspectRatio: 1 / 1.414,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    resizeMode: 'contain',
  },
  zoomHint: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  zoomHintText: {
    color: COLORS.textInverse,
    fontSize: 11,
    fontWeight: '600',
  },
  totalPanel: {
    backgroundColor: COLORS.textPrimary,
    borderRadius: 8,
    padding: 18,
  },
  totalLabel: {
    color: COLORS.textTertiary,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  totalValue: {
    color: COLORS.textInverse,
    fontSize: 28,
    fontWeight: '900',
    marginTop: 6,
  },
  confidence: {
    color: COLORS.primaryLight,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 8,
  },
  section: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
    gap: 2,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    flexWrap: 'wrap',
    gap: 8,
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: 17,
    fontWeight: '900',
    marginBottom: 8,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  addButtonText: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomColor: COLORS.borderLight,
    borderBottomWidth: 1,
    gap: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textSecondary,
    flex: 0.4,
  },
  input: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.textPrimary,
    textAlign: 'right',
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: COLORS.background,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  inputWrap: {
    flex: 0.6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  confidencePill: {
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 10,
  },
  confidenceOk: {
    backgroundColor: COLORS.successLight,
    color: COLORS.successDark,
  },
  confidenceLow: {
    backgroundColor: COLORS.errorLight,
    color: COLORS.errorDark,
  },
  taxBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  taxBadgeGreen: {
    backgroundColor: COLORS.successLight,
  },
  taxBadgeAmber: {
    backgroundColor: COLORS.warningLight,
  },
  taxBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  categoryTrigger: {
    flex: 0.6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: COLORS.background,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  categoryTriggerText: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.textPrimary,
  },
  categoryTriggerPlaceholder: {
    color: COLORS.textTertiary,
  },
  categoryCancelBtn: {
    marginTop: 12,
    padding: 12,
    backgroundColor: COLORS.borderLight,
    borderRadius: 8,
    alignItems: 'center',
  },
  categoryCancelText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  categoryModal: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    maxHeight: '70%',
  },
  categoryModalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: COLORS.textPrimary,
    marginBottom: 16,
    textAlign: 'center',
  },
  categoryOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomColor: COLORS.borderLight,
    borderBottomWidth: 1,
  },
  categoryOptionSelected: {
    backgroundColor: COLORS.primaryLight,
  },
  categoryOptionText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  categoryOptionTextSelected: {
    color: COLORS.primary,
    fontWeight: '800',
  },
  itemHeader: {
    backgroundColor: COLORS.borderLight,
    borderRadius: 6,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 9,
    marginBottom: 4,
  },
  itemHeadText: {
    color: COLORS.textSecondary,
    flex: 1,
    fontSize: 10,
    fontWeight: '900',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  itemRow: {
    alignItems: 'center',
    borderBottomColor: COLORS.borderLight,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingVertical: 6,
  },
  itemNameCol: {
    flex: 1.8,
  },
  itemRowError: {
    borderColor: COLORS.error,
    borderWidth: 1,
    borderRadius: 4,
  },
  itemNumCol: {
    flex: 1,
    textAlign: 'center',
    minWidth: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInput: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    backgroundColor: COLORS.background,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 4,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  inferredQty: {
    fontSize: 10,
    fontWeight: '900',
    color: COLORS.warning,
    marginLeft: 2,
  },
  deleteButton: {
    padding: 4,
  },
  muted: {
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    fontSize: 13,
  },
  rawText: {
    color: COLORS.textSecondary,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  actionGrid: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
  },
});
