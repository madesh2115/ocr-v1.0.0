import React from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { triggerHaptic } from '../hooks/useHaptics';
import { COLORS, RADIUS, SPACING } from '../theme/designSystem';

interface SecondaryButtonProps {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  flex?: number;
  style?: StyleProp<ViewStyle>;
}

export function SecondaryButton({ icon, label, onPress, disabled, loading, flex, style }: SecondaryButtonProps) {
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
        flex != null && { flex },
        pressed && styles.pressed,
        (disabled || loading) && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={COLORS.primary} size="small" />
      ) : icon ? (
        <Ionicons name={icon} size={20} color={COLORS.primary} />
      ) : null}
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.primaryLight,
    borderColor: COLORS.primary,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    minHeight: 44,
  },
  pressed: {
    opacity: 0.8,
  },
  disabled: {
    opacity: 0.45,
  },
  text: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '700',
  },
});
