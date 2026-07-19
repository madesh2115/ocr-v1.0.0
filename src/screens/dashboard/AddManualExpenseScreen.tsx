import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Modal,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../hooks/useToast';
import { triggerHaptic } from '../../hooks/useHaptics';
import { PrimaryButton } from '../../components/PrimaryButton';
import { getApiBaseUrl } from '../../utils/apiConfig';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY } from '../../theme/designSystem';

const API_BASE = getApiBaseUrl();

type Props = { navigation: any };

const PAYMENT_METHODS = ['Cash', 'Card', 'UPI', 'Other'];

const DEFAULT_CATEGORIES = [
  { id: 1, name: 'Food & Dining' },
  { id: 2, name: 'Travel' },
  { id: 3, name: 'Shopping' },
  { id: 4, name: 'Utilities' },
  { id: 5, name: 'Healthcare' },
  { id: 6, name: 'Entertainment' },
  { id: 7, name: 'Groceries' },
  { id: 8, name: 'Other' },
];

export function AddManualExpenseScreen({ navigation }: Props) {
  const { token } = useAuth();
  const showToast = useToast();

  const [vendor, setVendor] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date());
  const [expenseCategory, setExpenseCategory] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>('Cash');
  const [isSaving, setIsSaving] = useState(false);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showPaymentPicker, setShowPaymentPicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const response = await fetch(`${API_BASE.replace(/\/$/, '')}/categories`, {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      });
      if (response.ok) {
        const data = await response.json();
        setCategories(data.categories?.length ? data.categories : DEFAULT_CATEGORIES);
      }
    } catch {
      setCategories(DEFAULT_CATEGORIES);
    } finally {
      setLoadingCategories(false);
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!vendor.trim()) newErrors.vendor = 'Vendor name is required';
    if (!amount.trim()) newErrors.amount = 'Amount is required';
    else if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) newErrors.amount = 'Invalid amount';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const formatDateForApi = (d: Date): string => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const formatDateDisplay = (d: Date): string => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      triggerHaptic('warning');
      showToast('Please fill required fields', 'error');
      return;
    }

    setIsSaving(true);
    triggerHaptic('medium');

    try {
      const response = await fetch(`${API_BASE.replace(/\/$/, '')}/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token ?? ''}`,
        },
        body: JSON.stringify({
          vendor: vendor.trim(),
          grand_total: parseFloat(amount).toFixed(2),
          date: formatDateForApi(date),
          expense_category: expenseCategory || 'Other',
          payment_method: paymentMethod,
        }),
      });

      if (response.ok) {
        triggerHaptic('success');
        showToast('Expense saved!', 'success');
        navigation.goBack();
      } else {
        const data = await response.json().catch(() => ({}));
        showToast(data.error?.message || 'Failed to save', 'error');
      }
    } catch {
      showToast('Network error. Please try again.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Add Expense</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          {/* Vendor */}
          <View style={styles.field}>
            <Text style={styles.label}>Vendor *</Text>
            <TextInput
              style={[styles.input, errors.vendor && styles.inputError]}
              value={vendor}
              onChangeText={setVendor}
              placeholder="e.g. Swiggy, Uber"
              placeholderTextColor={COLORS.textTertiary}
            />
            {errors.vendor && <Text style={styles.error}>{errors.vendor}</Text>}
          </View>

          {/* Amount */}
          <View style={styles.field}>
            <Text style={styles.label}>Amount *</Text>
            <View style={styles.amountWrapper}>
              <Text style={styles.currency}>₹</Text>
              <TextInput
                style={[styles.input, styles.amountInput, errors.amount && styles.inputError]}
                value={amount}
                onChangeText={setAmount}
                placeholder="0.00"
                placeholderTextColor={COLORS.textTertiary}
                keyboardType="decimal-pad"
              />
            </View>
            {errors.amount && <Text style={styles.error}>{errors.amount}</Text>}
          </View>

          {/* Date */}
          <View style={styles.field}>
            <Text style={styles.label}>Date</Text>
            <Pressable style={styles.picker} onPress={() => setShowDatePicker(true)}>
              <Ionicons name="calendar-outline" size={18} color={COLORS.textSecondary} />
              <Text style={styles.pickerText}>{formatDateDisplay(date)}</Text>
            </Pressable>
          </View>

          {/* Category */}
          <View style={styles.field}>
            <Text style={styles.label}>Category</Text>
            <Pressable style={styles.picker} onPress={() => setShowCategoryPicker(true)} disabled={loadingCategories}>
              {loadingCategories ? (
                <ActivityIndicator size="small" color={COLORS.primary} />
              ) : (
                <>
                  <Text style={[styles.pickerText, !expenseCategory && styles.placeholder]}>
                    {expenseCategory || 'Select category'}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={COLORS.textSecondary} />
                </>
              )}
            </Pressable>
          </View>

          {/* Payment Method */}
          <View style={styles.field}>
            <Text style={styles.label}>Payment Method</Text>
            <Pressable style={styles.picker} onPress={() => setShowPaymentPicker(true)}>
              <Text style={styles.pickerText}>{paymentMethod}</Text>
              <Ionicons name="chevron-down" size={16} color={COLORS.textSecondary} />
            </Pressable>
          </View>

          {/* Save Button */}
          <PrimaryButton
            label={isSaving ? 'Saving...' : 'Save Expense'}
            onPress={handleSave}
            disabled={isSaving}
            loading={isSaving}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Category Picker */}
      <Modal visible={showCategoryPicker} transparent animationType="slide" onRequestClose={() => setShowCategoryPicker(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowCategoryPicker(false)}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Select Category</Text>
            <ScrollView>
              {categories.map((cat) => (
                <Pressable
                  key={cat.id}
                  style={[styles.option, cat.name === expenseCategory && styles.optionSelected]}
                  onPress={() => { setExpenseCategory(cat.name); setShowCategoryPicker(false); }}
                >
                  <Text style={[styles.optionText, cat.name === expenseCategory && styles.optionTextSelected]}>{cat.name}</Text>
                  {cat.name === expenseCategory && <Ionicons name="checkmark" size={18} color={COLORS.primary} />}
                </Pressable>
              ))}
            </ScrollView>
            <Pressable style={styles.cancelBtn} onPress={() => setShowCategoryPicker(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Payment Picker */}
      <Modal visible={showPaymentPicker} transparent animationType="slide" onRequestClose={() => setShowPaymentPicker(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowPaymentPicker(false)}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Payment Method</Text>
            {PAYMENT_METHODS.map((method) => (
              <Pressable
                key={method}
                style={[styles.option, method === paymentMethod && styles.optionSelected]}
                onPress={() => { setPaymentMethod(method); setShowPaymentPicker(false); }}
              >
                <Text style={[styles.optionText, method === paymentMethod && styles.optionTextSelected]}>{method}</Text>
                {method === paymentMethod && <Ionicons name="checkmark" size={18} color={COLORS.primary} />}
              </Pressable>
            ))}
            <Pressable style={styles.cancelBtn} onPress={() => setShowPaymentPicker(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Date Picker */}
      <Modal visible={showDatePicker} transparent animationType="slide" onRequestClose={() => setShowDatePicker(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowDatePicker(false)}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Select Date</Text>
            <View style={styles.quickDates}>
              <Pressable style={styles.quickBtn} onPress={() => { setDate(new Date()); setShowDatePicker(false); }}>
                <Text style={styles.quickBtnText}>Today</Text>
              </Pressable>
              <Pressable style={styles.quickBtn} onPress={() => { const d = new Date(); d.setDate(d.getDate() - 1); setDate(d); setShowDatePicker(false); }}>
                <Text style={styles.quickBtnText}>Yesterday</Text>
              </Pressable>
            </View>
            <View style={styles.dateDisplay}>
              <Ionicons name="calendar" size={24} color={COLORS.primary} />
              <Text style={styles.dateDisplayText}>{formatDateDisplay(date)}</Text>
            </View>
            <TextInput
              style={styles.dateInput}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={COLORS.textTertiary}
              keyboardType="numeric"
              onChangeText={(text) => {
                const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                if (m) {
                  const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
                  if (!isNaN(d.getTime())) setDate(d);
                }
              }}
            />
            <Pressable style={styles.cancelBtn} onPress={() => setShowDatePicker(false)}>
              <Text style={styles.cancelText}>Done</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '900', color: COLORS.textPrimary },
  form: { padding: 20, gap: 20, paddingBottom: 100 },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '700', color: COLORS.textSecondary },
  input: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, fontWeight: '600', color: COLORS.textPrimary,
  },
  inputError: { borderColor: COLORS.error },
  error: { fontSize: 12, fontWeight: '600', color: COLORS.error },
  amountWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10 },
  currency: { fontSize: 18, fontWeight: '700', color: COLORS.primary, paddingLeft: 14 },
  amountInput: { flex: 1, borderWidth: 0 },
  picker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 13,
  },
  pickerText: { fontSize: 16, fontWeight: '600', color: COLORS.textPrimary },
  placeholder: { color: COLORS.textTertiary },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal: { backgroundColor: COLORS.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, maxHeight: '70%' },
  modalTitle: { fontSize: 18, fontWeight: '900', color: COLORS.textPrimary, marginBottom: 16, textAlign: 'center' },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  optionSelected: { backgroundColor: COLORS.primaryLight },
  optionText: { fontSize: 16, fontWeight: '600', color: COLORS.textPrimary },
  optionTextSelected: { color: COLORS.primary, fontWeight: '800' },
  cancelBtn: { marginTop: 16, padding: 14, backgroundColor: COLORS.borderLight, borderRadius: 8, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '700', color: COLORS.textSecondary },
  quickDates: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  quickBtn: { flex: 1, backgroundColor: COLORS.primaryLight, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  quickBtnText: { fontSize: 14, fontWeight: '700', color: COLORS.primary },
  dateDisplay: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16, backgroundColor: COLORS.background, borderRadius: 8, marginBottom: 16 },
  dateDisplayText: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
  dateInput: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontWeight: '600', color: COLORS.textPrimary, textAlign: 'center', marginBottom: 16,
  },
});
