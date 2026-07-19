import React from 'react';
import { Modal, View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, RADIUS, SPACING } from '../theme/designSystem';

interface PermissionDialogProps {
  visible: boolean;
  type: 'camera' | 'gallery';
  onConfirm: () => void;
  onCancel: () => void;
}

export function PermissionDialog({ visible, type, onConfirm, onCancel }: PermissionDialogProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.overlay} onPress={onCancel}>
        <Pressable style={[styles.dialog, { marginBottom: insets.bottom + 20 }]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.iconWrap}>
            <Ionicons
              name={type === 'camera' ? 'camera-outline' : 'images-outline'}
              size={36}
              color={COLORS.primary}
            />
          </View>
          <Text style={styles.title}>
            {type === 'camera' ? 'Camera Access Needed' : 'Photo Library Access Needed'}
          </Text>
          <Text style={styles.body}>
            {type === 'camera'
              ? 'We need camera access to photograph your bills and receipts for OCR extraction.'
              : 'We need photo library access to select bill and receipt images from your gallery.'}
          </Text>
          <View style={styles.buttons}>
            <Pressable style={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.confirmBtn} onPress={onConfirm}>
              <Text style={styles.confirmText}>Allow</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  dialog: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  body: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: SPACING.lg,
  },
  buttons: {
    flexDirection: 'row',
    gap: SPACING.md,
    width: '100%',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  confirmText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textInverse,
  },
});
