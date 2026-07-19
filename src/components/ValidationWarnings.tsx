import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type TaxValidationWarning = {
  message: string;
  severity: 'error' | 'warning';
  diff?: string | null;
};

type GstinValidation = {
  valid: boolean;
  formatted: string | null;
  error: string | null;
};

type DateValidation = {
  valid: boolean;
  parsed: string | null;
  error: string | null;
};

type BillValidation = {
  line_items?: Array<{
    totals_match?: string;
    expected_total?: string | null;
    item_name?: string | null;
  }>;
  tax_warnings: Record<string, TaxValidationWarning>;
  price_includes_tax?: 'yes' | 'no' | null;
  gstin: GstinValidation;
  date: DateValidation;
};

type Props = {
  validation?: BillValidation;
};

export function ValidationWarnings({ validation }: Props) {
  if (!validation) return null;

  const { tax_warnings, price_includes_tax, gstin, date } = validation;
  const warnings: Array<{ icon: string; color: string; text: string }> = [];

  // Tax warnings
  if (tax_warnings) {
    for (const [key, w] of Object.entries(tax_warnings)) {
      warnings.push({
        icon: w.severity === 'error' ? 'alert-circle' : 'warning',
        color: w.severity === 'error' ? '#EF4444' : '#F59E0B',
        text: w.message,
      });
    }
  }

  // Price includes tax hint
  if (price_includes_tax === 'yes') {
    warnings.push({
      icon: 'information-circle',
      color: '#3B82F6',
      text: 'Prices on this bill appear to include GST.',
    });
  } else if (price_includes_tax === 'no') {
    warnings.push({
      icon: 'information-circle',
      color: '#3B82F6',
      text: 'Prices appear to be exclusive of GST.',
    });
  }

  // GSTIN validation
  if (gstin && !gstin.valid && gstin.error) {
    warnings.push({
      icon: 'alert-circle',
      color: '#EF4444',
      text: `GSTIN: ${gstin.error}`,
    });
  }

  // Date validation
  if (date && !date.valid && date.error) {
    warnings.push({
      icon: 'alert-circle',
      color: '#EF4444',
      text: `Date: ${date.error}`,
    });
  }

  if (warnings.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="shield-checkmark-outline" size={16} color="#F59E0B" />
        <Text style={styles.headerText}>Validation</Text>
      </View>
      {warnings.map((w, i) => (
        <View key={i} style={styles.row}>
          <Ionicons name={w.icon as any} size={14} color={w.color} />
          <Text style={[styles.text, { color: w.color }]}>{w.text}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    gap: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  headerText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#92400E',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  text: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
  },
});
