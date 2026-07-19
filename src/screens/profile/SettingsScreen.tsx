import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, Switch, StyleSheet, Alert } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useToast } from '../../hooks/useToast';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY, TOUCH } from '../../theme/designSystem';
import type { RootStackParamList } from '../../types';

type Props = StackScreenProps<RootStackParamList, 'Settings'>;

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD'];
const PAYMENT_METHODS = ['Cash', 'Credit Card', 'Debit Card', 'UPI', 'Bank Transfer', 'Other'];
const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

export function SettingsScreen({ navigation }: Props) {
  const showToast = useToast();
  const [darkMode, setDarkMode] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [currency, setCurrency] = useState('INR');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [showPaymentPicker, setShowPaymentPicker] = useState(false);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Appearance */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Appearance</Text>
        <View style={styles.card}>
          <ToggleRow icon="moon-outline" label="Dark Mode" value={darkMode} onValueChange={(val) => { setDarkMode(val); showToast(val ? 'Dark mode enabled' : 'Dark mode disabled', 'info'); }} />
          <ToggleRow icon="notifications-outline" label="Notifications" value={notifications} onValueChange={setNotifications} />
        </View>
      </View>

      {/* Defaults */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Defaults</Text>
        <View style={styles.card}>
          <Pressable style={styles.settingRow} onPress={() => setShowCurrencyPicker(!showCurrencyPicker)}>
            <View style={styles.settingLeft}>
              <View style={styles.iconContainer}><Ionicons name="cash-outline" size={20} color={COLORS.primary} /></View>
              <View><Text style={styles.settingLabel}>Currency</Text><Text style={styles.settingValue}>{currency}</Text></View>
            </View>
            <Ionicons name={showCurrencyPicker ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
          </Pressable>
          {showCurrencyPicker && (
            <View style={styles.pickerList}>
              {CURRENCIES.map((c) => (
                <Pressable key={c} style={[styles.pickerOption, currency === c && styles.pickerOptionActive]} onPress={() => { setCurrency(c); setShowCurrencyPicker(false); }}>
                  <Text style={[styles.pickerOptionText, currency === c && styles.pickerOptionTextActive]}>{c}</Text>
                  {currency === c && <Ionicons name="checkmark" size={18} color={COLORS.primary} />}
                </Pressable>
              ))}
            </View>
          )}

          <Pressable style={styles.settingRow} onPress={() => setShowPaymentPicker(!showPaymentPicker)}>
            <View style={styles.settingLeft}>
              <View style={styles.iconContainer}><Ionicons name="card-outline" size={20} color={COLORS.primary} /></View>
              <View><Text style={styles.settingLabel}>Payment Method</Text><Text style={styles.settingValue}>{paymentMethod}</Text></View>
            </View>
            <Ionicons name={showPaymentPicker ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
          </Pressable>
          {showPaymentPicker && (
            <View style={styles.pickerList}>
              {PAYMENT_METHODS.map((pm) => (
                <Pressable key={pm} style={[styles.pickerOption, paymentMethod === pm && styles.pickerOptionActive]} onPress={() => { setPaymentMethod(pm); setShowPaymentPicker(false); }}>
                  <Text style={[styles.pickerOptionText, paymentMethod === pm && styles.pickerOptionTextActive]}>{pm}</Text>
                  {paymentMethod === pm && <Ionicons name="checkmark" size={18} color={COLORS.primary} />}
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </View>

      {/* Data */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data</Text>
        <View style={styles.card}>
          <Pressable style={styles.settingRow} onPress={() => showToast('Export data coming soon', 'info')}>
            <View style={styles.settingLeft}>
              <View style={styles.iconContainer}><Ionicons name="download-outline" size={20} color={COLORS.primary} /></View>
              <Text style={styles.settingLabel}>Export Data</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textTertiary} />
          </Pressable>
        </View>
      </View>

      {/* About */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.card}>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>App Version</Text>
            <Text style={styles.aboutValue}>{APP_VERSION}</Text>
          </View>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Build</Text>
            <Text style={styles.aboutValue}>1</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

function ToggleRow({ icon, label, value, onValueChange }: { icon: string; label: string; value: boolean; onValueChange: (val: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.settingLeft}>
        <View style={styles.iconContainer}><Ionicons name={icon as any} size={20} color={COLORS.primary} /></View>
        <Text style={styles.settingLabel}>{label}</Text>
      </View>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ false: COLORS.border, true: COLORS.primary }} thumbColor={COLORS.surface} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { paddingBottom: 100 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerTitle: { ...TYPOGRAPHY.h3, color: COLORS.textPrimary },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  section: { paddingHorizontal: SPACING.md, marginTop: SPACING.lg },
  sectionTitle: { ...TYPOGRAPHY.caption, color: COLORS.textSecondary, textTransform: 'uppercase', marginBottom: SPACING.sm, marginLeft: SPACING.xs },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  settingLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  iconContainer: { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center' },
  settingLabel: { ...TYPOGRAPHY.body, color: COLORS.textPrimary },
  settingValue: { ...TYPOGRAPHY.caption, color: COLORS.textSecondary, marginTop: 2 },
  pickerList: { borderTopWidth: 1, borderTopColor: COLORS.borderLight, backgroundColor: COLORS.borderLight },
  pickerOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  pickerOptionActive: { backgroundColor: COLORS.primaryLight },
  pickerOptionText: { ...TYPOGRAPHY.body, color: COLORS.textPrimary },
  pickerOptionTextActive: { color: COLORS.primary, fontWeight: '600' },
  aboutRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  aboutLabel: { ...TYPOGRAPHY.body, color: COLORS.textSecondary },
  aboutValue: { ...TYPOGRAPHY.body, fontWeight: '600', color: COLORS.textPrimary },
});
