import React from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { triggerHaptic } from '../hooks/useHaptics';
import { COLORS, RADIUS, SPACING } from '../theme/designSystem';

interface PrimaryButtonProps {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export function PrimaryButton({ icon, label, onPress, disabled, loading }: PrimaryButtonProps) {
  const handlePress = () => {
    if (!disabled && !loading) {
      triggerHaptic('light');
      onPress();
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.pressed,
        (disabled || loading) && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={COLORS.textInverse} size="small" />
      ) : icon ? (
        <Ionicons name={icon} size={20} color={COLORS.textInverse} />
      ) : null}
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    minHeight: 48,
  },
  pressed: {
    opacity: 0.8,
  },
  disabled: {
    opacity: 0.45,
  },
  text: {
    color: COLORS.textInverse,
    fontSize: 16,
    fontWeight: '700',
  },
});
