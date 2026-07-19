import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator,
  TextInput, Modal, KeyboardAvoidingView, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, authFetch } from '../../context/AuthContext';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useToast } from '../../hooks/useToast';
import { formatMoney, formatDate } from '../../utils/formatters';
import { triggerHaptic } from '../../hooks/useHaptics';
import { getApiBaseUrl } from '../../utils/apiConfig';
import type { ExtractionResult, LineItem } from '../../types';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY } from '../../theme/designSystem';

const API_BASE = getApiBaseUrl();

type Props = { navigation: any; route: any };

const EXPENSE_CATEGORIES = [
  'Food & Dining', 'Travel', 'Shopping', 'Utilities', 'Medical',
  'Entertainment', 'Education', 'Office Supplies', 'Fuel', 'Other',
];

type FetchState = 'loading' | 'success' | 'error';

function EditableFieldRow({
  label,
  value,
  onChangeText,
  keyboardType = 'default',
}: {
  label: string;
  value: string | number | null | undefined;
  onChangeText: (text: string) => void;
  keyboardType?: 'default' | 'numeric';
}) {
  const displayValue = value != null ? String(value) : '';
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={displayValue}
        onChangeText={onChangeText}
        placeholder="Not found"
        placeholderTextColor={COLORS.textTertiary}
        keyboardType={keyboardType}
        editable={true}
      />
    </View>
  );
}

function InfoRow({ label, value, icon }: { label: string; value: string | null | undefined; icon?: keyof typeof Ionicons.glyphMap }) {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      {icon && <Ionicons name={icon} size={16} color={COLORS.textSecondary} style={{ marginRight: 8 }} />}
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function TaxBreakdownRow({ label, value, currency }: { label: string; value: string | null | undefined; currency: string }) {
  const num = parseFloat(String(value ?? '0'));
  if (isNaN(num) || num === 0) return null;
  return (
    <View style={styles.taxRow}>
      <Text style={styles.taxLabel}>{label}</Text>
      <Text style={styles.taxValue}>{formatMoney(value, currency)}</Text>
    </View>
  );
}

function LineItemRow({ item, currency, onUpdate, onDelete, isEditing }: {
  item: LineItem;
  currency: string;
  onUpdate: (key: keyof LineItem, val: string) => void;
  onDelete: () => void;
  isEditing: boolean;
}) {
  return (
    <View style={styles.lineItemRow}>
      <View style={styles.lineItemLeft}>
        <TextInput
          style={[styles.lineItemName, isEditing && styles.lineItemInput]}
          value={item.name ?? item.item_name ?? ''}
          onChangeText={(v) => onUpdate('name', v)}
          placeholder="Item name"
          placeholderTextColor={COLORS.textTertiary}
          editable={isEditing}
        />
        <TextInput
          style={[styles.lineItemQty, isEditing && styles.lineItemInput]}
          value={item.quantity ?? '1'}
          onChangeText={(v) => onUpdate('quantity', v)}
          placeholder="Qty"
          placeholderTextColor={COLORS.textTertiary}
          keyboardType="numeric"
          editable={isEditing}
        />
      </View>
      <View style={styles.lineItemRight}>
        <Text style={styles.lineItemTotal}>{formatMoney(item.total ?? item.amount, currency)}</Text>
        {isEditing && (
          <Pressable onPress={onDelete} style={styles.deleteBtn}>
            <Ionicons name="trash-outline" size={16} color={COLORS.error} />
          </Pressable>
        )}
      </View>
    </View>
  );
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

export function DocumentDetailScreen({ navigation, route }: Props) {
  const { documentId } = route.params;
  const { refreshToken } = useAuth();
  const { status: networkStatus } = useNetworkStatus();
  const showToast = useToast();

  const [document, setDocument] = useState<ExtractionResult | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);

  // Editable copy
  const [editVendor, setEditVendor] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editInvoice, setEditInvoice] = useState('');
  const [editPaymentMethod, setEditPaymentMethod] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editSubtotal, setEditSubtotal] = useState('');
  const [editCgst, setEditCgst] = useState('');
  const [editSgst, setEditSgst] = useState('');
  const [editIgst, setEditIgst] = useState('');
  const [editCess, setEditCess] = useState('');
  const [editGrandTotal, setEditGrandTotal] = useState('');
  const [editLineItems, setEditLineItems] = useState<LineItem[]>([]);

  const fetchDocument = useCallback(async () => {
    setFetchState('loading');
    setErrorMsg(null);
    try {
      const response = await authFetch(
        `/documents/${documentId}`,
        { method: 'GET' },
        refreshToken
      );
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const data: ExtractionResult = await response.json();
      setDocument(data);
      initEditFields(data);
      setFetchState('success');
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Failed to load document');
      setFetchState('error');
    }
  }, [documentId, refreshToken]);

  const initEditFields = (doc: ExtractionResult) => {
    setEditVendor(typeof doc.vendor === 'string' ? doc.vendor : (doc.vendor?.name ?? ''));
    setEditDate(doc.document?.date ?? doc.date ?? '');
    setEditInvoice(doc.document?.invoice_number ?? doc.invoice_number ?? '');
    setEditPaymentMethod(doc.transaction?.payment_method ?? doc.payment_method ?? '');
    setEditCategory(doc.transaction?.expense_category ?? '');
    setEditSubtotal(doc.amounts?.subtotal ?? doc.subtotal ?? '');
    setEditCgst(doc.amounts?.cgst ?? doc.cgst ?? '0.00');
    setEditSgst(doc.amounts?.sgst ?? doc.sgst ?? '0.00');
    setEditIgst(doc.amounts?.igst ?? '0.00');
    setEditCess(doc.amounts?.cess ?? doc.cess ?? '0.00');
    setEditGrandTotal(doc.amounts?.grand_total ?? doc.grand_total ?? doc.total ?? '');
    setEditLineItems(doc.line_items ? [...doc.line_items] : []);
  };

  useEffect(() => {
    fetchDocument();
  }, [fetchDocument]);

  const handleEdit = () => {
    if (document) {
      initEditFields(document);
    }
    setIsEditing(true);
    triggerHaptic('light');
  };

  const handleCancel = () => {
    setIsEditing(false);
    triggerHaptic('light');
  };

  const handleSave = async () => {
    if (!document) return;
    setIsSaving(true);
    triggerHaptic('medium');

    const updatedDoc: ExtractionResult = {
      ...document,
      vendor: { ...document.vendor, name: editVendor },
      document: {
        ...document.document,
        date: editDate,
        invoice_number: editInvoice,
      },
      transaction: {
        ...document.transaction,
        payment_method: editPaymentMethod,
        expense_category: editCategory,
      },
      amounts: {
        ...document.amounts,
        subtotal: editSubtotal,
        cgst: editCgst,
        sgst: editSgst,
        igst: editIgst,
        cess: editCess,
        grand_total: editGrandTotal,
      },
      line_items: editLineItems,
    };

    try {
      const response = await authFetch(
        `/documents/${documentId}/update`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedDoc),
        },
        refreshToken
      );

      if (response.ok) {
        showToast('Document saved successfully!', 'success');
        triggerHaptic('success');
        setIsEditing(false);
        const data = await response.json();
        if (data) {
          setDocument(data);
        }
      } else {
        const err = await response.json().catch(() => ({ error: 'Save failed' }));
        showToast(err.error || 'Failed to save', 'error');
        triggerHaptic('error');
      }
    } catch (err: any) {
      showToast('Network error saving document', 'error');
      triggerHaptic('error');
    } finally {
      setIsSaving(false);
    }
  };

  const updateLineItem = (index: number, key: keyof LineItem, val: string) => {
    const updated = [...editLineItems];
    updated[index] = { ...updated[index], [key]: val };
    setEditLineItems(updated);
  };

  const deleteLineItem = (index: number) => {
    const updated = editLineItems.filter((_, i) => i !== index);
    setEditLineItems(updated);
    triggerHaptic('warning');
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
      manually_corrected: true,
      item_name: '',
      text: null,
      rate: '',
      amount: null,
      gst: '',
      raw_text: null,
      learned: false,
    };
    setEditLineItems([...editLineItems, newItem]);
    triggerHaptic('light');
  };

  const currencyCode = document?.document?.currency ?? document?.currency ?? 'INR';
  const grandTotal = document?.amounts?.grand_total ?? document?.grand_total ?? document?.total ?? '0';
  const cgst = parseFloat(String(document?.amounts?.cgst ?? document?.cgst ?? '0'));
  const sgst = parseFloat(String(document?.amounts?.sgst ?? document?.sgst ?? '0'));
  const igst = parseFloat(String(document?.amounts?.igst ?? '0'));
  const hasIgst = !isNaN(igst) && igst > 0;
  const hasTax = (!isNaN(cgst) && cgst > 0) || (!isNaN(sgst) && sgst > 0) || hasIgst;

  if (fetchState === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.screenHeader}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </Pressable>
          <Text style={styles.screenTitle}>Document</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading document...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (fetchState === 'error' || !document) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.screenHeader}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </Pressable>
          <Text style={styles.screenTitle}>Document</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.errorState}>
          <Ionicons name="cloud-offline-outline" size={56} color={COLORS.error} />
          <Text style={styles.errorTitle}>Failed to load document</Text>
          <Text style={styles.errorSubtitle}>{errorMsg}</Text>
          <Pressable style={styles.retryButton} onPress={fetchDocument}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {networkStatus === 'offline' && (
        <View style={styles.offlineBanner}>
          <Ionicons name="wifi-outline" size={16} color={COLORS.warningDark} />
          <Text style={styles.offlineText}>You are offline.</Text>
        </View>
      )}

      {/* Header */}
      <View style={styles.screenHeader}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </Pressable>
        <Text style={styles.screenTitle} numberOfLines={1}>
          {isEditing ? 'Edit Document' : (typeof document.vendor === 'string' ? document.vendor : (document.vendor?.name ?? 'Document'))}
        </Text>
        {isEditing ? (
          <View style={{ width: 40 }} />
        ) : (
          <Pressable onPress={handleEdit} style={styles.editBtn}>
            <Ionicons name="create-outline" size={20} color={COLORS.primary} />
          </Pressable>
        )}
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Amount */}
          <View style={styles.amountPanel}>
            <Text style={styles.amountLabel}>TOTAL</Text>
            <Text style={styles.amountValue}>
              {formatMoney(isEditing ? editGrandTotal : grandTotal, currencyCode)}
            </Text>
            {document.ocr_metadata?.overall_confidence != null && (
              <Text style={styles.confidenceText}>
                Confidence: {Math.round(document.ocr_metadata.overall_confidence * 100)}%
              </Text>
            )}
          </View>

          {isEditing ? (
            // ── Edit Mode ─────────────────────────────────────────────────────
            <>
              {/* Vendor */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Vendor</Text>
                <EditableFieldRow label="Name" value={editVendor} onChangeText={setEditVendor} />
              </View>

              {/* Document Info */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Document Info</Text>
                <EditableFieldRow label="Invoice #" value={editInvoice} onChangeText={setEditInvoice} />
                <EditableFieldRow label="Date" value={editDate} onChangeText={setEditDate} />
              </View>

              {/* Transaction */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Transaction</Text>
                <EditableFieldRow label="Payment Method" value={editPaymentMethod} onChangeText={setEditPaymentMethod} />
                <View style={styles.row}>
                  <Text style={styles.label}>Category</Text>
                  <Pressable style={styles.categoryTrigger} onPress={() => setCategoryModalVisible(true)}>
                    <Text style={[styles.categoryTriggerText, !editCategory && styles.categoryTriggerPlaceholder]}>
                      {editCategory || 'Select category'}
                    </Text>
                    <Ionicons name="chevron-down" size={16} color={COLORS.textSecondary} />
                  </Pressable>
                </View>
              </View>

              {/* Amounts */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Amounts</Text>
                <EditableFieldRow label="Subtotal" value={editSubtotal} onChangeText={setEditSubtotal} keyboardType="numeric" />
                <EditableFieldRow label="CGST" value={editCgst} onChangeText={setEditCgst} keyboardType="numeric" />
                <EditableFieldRow label="SGST" value={editSgst} onChangeText={setEditSgst} keyboardType="numeric" />
                <EditableFieldRow label="IGST" value={editIgst} onChangeText={setEditIgst} keyboardType="numeric" />
                <EditableFieldRow label="Cess" value={editCess} onChangeText={setEditCess} keyboardType="numeric" />
                <EditableFieldRow label="Grand Total" value={editGrandTotal} onChangeText={setEditGrandTotal} keyboardType="numeric" />
              </View>

              {/* Line Items */}
              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>Line Items</Text>
                  <Pressable style={styles.addButton} onPress={addLineItem}>
                    <Ionicons name="add" size={14} color={COLORS.primary} />
                    <Text style={styles.addButtonText}>Add Item</Text>
                  </Pressable>
                </View>
                {editLineItems.length > 0 ? (
                  editLineItems.map((item, index) => (
                    <LineItemRow
                      key={index}
                      item={item}
                      currency={currencyCode}
                      onUpdate={(key, val) => updateLineItem(index, key, val)}
                      onDelete={() => deleteLineItem(index)}
                      isEditing={true}
                    />
                  ))
                ) : (
                  <Text style={styles.muted}>No line items.</Text>
                )}
              </View>

              {/* Edit Actions */}
              <View style={styles.editActions}>
                <Pressable style={styles.cancelBtn} onPress={handleCancel}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]}
                  onPress={handleSave}
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <ActivityIndicator size="small" color={COLORS.textInverse} />
                  ) : (
                    <>
                      <Ionicons name="save-outline" size={18} color={COLORS.textInverse} />
                      <Text style={styles.saveBtnText}>Save</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </>
          ) : (
            // ── View Mode ─────────────────────────────────────────────────────
            <>
              {/* Info Rows */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Details</Text>
                <InfoRow
                  label="Invoice #"
                  value={document.document?.invoice_number ?? document.invoice_number}
                  icon="document-text-outline"
                />
                <InfoRow
                  label="Date"
                  value={formatDate(document.document?.date ?? document.date)}
                  icon="calendar-outline"
                />
                <InfoRow
                  label="Payment"
                  value={document.transaction?.payment_method ?? document.payment_method}
                  icon="card-outline"
                />
                <InfoRow
                  label="Category"
                  value={document.transaction?.expense_category}
                  icon="pricetag-outline"
                />
              </View>

              {/* Tax Breakdown */}
              {hasTax && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Tax Breakdown</Text>
                  <TaxBreakdownRow label="CGST" value={document.amounts?.cgst ?? document.cgst} currency={currencyCode} />
                  <TaxBreakdownRow label="SGST" value={document.amounts?.sgst ?? document.sgst} currency={currencyCode} />
                  {hasIgst && <TaxBreakdownRow label="IGST" value={document.amounts?.igst} currency={currencyCode} />}
                  <TaxBreakdownRow label="Cess" value={document.amounts?.cess ?? document.cess} currency={currencyCode} />
                  {document.amounts?.tax_total && (
                    <View style={styles.taxTotalRow}>
                      <Text style={styles.taxTotalLabel}>Total Tax</Text>
                      <Text style={styles.taxTotalValue}>
                        {formatMoney(document.amounts.tax_total, currencyCode)}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Subtotal if no tax shown */}
              {!hasTax && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Amount</Text>
                  <InfoRow label="Subtotal" value={formatMoney(document.amounts?.subtotal ?? document.subtotal, currencyCode)} />
                </View>
              )}

              {/* Line Items */}
              {document.line_items && document.line_items.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Line Items</Text>
                  {document.line_items.map((item, index) => (
                    <LineItemRow
                      key={index}
                      item={item}
                      currency={currencyCode}
                      onUpdate={() => {}}
                      onDelete={() => {}}
                      isEditing={false}
                    />
                  ))}
                </View>
              )}

              {/* Vendor Info */}
              {(document.vendor?.phone || document.vendor?.email || document.vendor?.gstin) && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Vendor Info</Text>
                  <InfoRow label="Phone" value={document.vendor?.phone ?? document.phone} icon="call-outline" />
                  <InfoRow label="Email" value={document.vendor?.email ?? document.email} icon="mail-outline" />
                  <InfoRow label="GSTIN" value={document.vendor?.gstin ?? document.tax_id} icon="shield-checkmark-outline" />
                </View>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <CategoryPickerModal
        visible={categoryModalVisible}
        current={editCategory || null}
        onSelect={setEditCategory}
        onClose={() => setCategoryModalVisible(false)}
      />
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
  editBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '900',
    color: COLORS.textPrimary,
    textAlign: 'center',
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
  scrollContent: {
    padding: 16,
    gap: 14,
    paddingBottom: 132,
  },
  amountPanel: {
    backgroundColor: COLORS.textPrimary,
    borderRadius: 14,
    padding: 20,
  },
  amountLabel: {
    color: COLORS.textTertiary,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  amountValue: {
    color: COLORS.textInverse,
    fontSize: 32,
    fontWeight: '900',
    marginTop: 6,
  },
  confidenceText: {
    color: COLORS.primaryLight,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
  },
  section: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '900',
    marginBottom: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
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
    paddingVertical: 10,
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
    flex: 0.6,
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
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomColor: COLORS.borderLight,
    borderBottomWidth: 1,
    gap: 8,
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    minWidth: 80,
  },
  infoValue: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.textPrimary,
    textAlign: 'right',
  },
  taxRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  taxLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  taxValue: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.textPrimary,
  },
  taxTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    marginTop: 4,
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
  },
  taxTotalLabel: {
    fontSize: 15,
    fontWeight: '900',
    color: COLORS.textPrimary,
  },
  taxTotalValue: {
    fontSize: 15,
    fontWeight: '900',
    color: COLORS.textPrimary,
  },
  lineItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomColor: COLORS.borderLight,
    borderBottomWidth: 1,
  },
  lineItemLeft: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  lineItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lineItemName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.textPrimary,
  },
  lineItemQty: {
    fontSize: 13,
    color: COLORS.textSecondary,
    minWidth: 30,
    textAlign: 'center',
  },
  lineItemInput: {
    backgroundColor: COLORS.background,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  lineItemTotal: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.textPrimary,
  },
  deleteBtn: {
    padding: 4,
  },
  muted: {
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    fontSize: 13,
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
  editActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    backgroundColor: COLORS.borderLight,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cancelBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.textSecondary,
  },
  saveBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    backgroundColor: COLORS.primary,
    borderRadius: 10,
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.textInverse,
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
});
