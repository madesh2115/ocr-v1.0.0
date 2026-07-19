import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { triggerHaptic } from '../hooks/useHaptics';
import { useToast } from '../hooks/useToast';

interface FieldRowProps {
  label: string;
  value: string | number | null | undefined;
}

export function FieldRow({ label, value }: FieldRowProps) {
  const showToast = useToast();

  const handleCopy = async () => {
    if (!value) return;
    await Clipboard.setStringAsync(String(value));
    triggerHaptic('success');
    showToast('Copied to clipboard', 'success');
  };

  const displayValue = value != null ? String(value) : null;

  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Pressable style={styles.valueWrap} onPress={handleCopy} disabled={!displayValue}>
        <Text style={[styles.value, !displayValue && styles.valueEmpty]}>
          {displayValue ?? '-'}
        </Text>
        {displayValue && (
          <Ionicons name="copy-outline" size={14} color="#94A3B8" style={styles.copyIcon} />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomColor: '#F1F5F9',
    borderBottomWidth: 1,
    gap: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748B',
    flex: 0.45,
  },
  valueWrap: {
    flex: 0.55,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  value: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'right',
  },
  valueEmpty: {
    color: '#CBD5E1',
  },
  copyIcon: {
    opacity: 0.6,
  },
});
