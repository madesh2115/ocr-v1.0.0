import React, { createContext, useState, useCallback, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme/designSystem';

export type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

export const ToastContext = createContext<ToastContextType>({ showToast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const insets = useSafeAreaInsets();
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev.slice(-2), { id, message, type }]);

    if (timersRef.current[id]) clearTimeout(timersRef.current[id]);
    timersRef.current[id] = setTimeout(() => removeToast(id), 2500);
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <View style={[styles.container, { bottom: insets.bottom + 16 }]} pointerEvents="box-none">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

const ToastColors: Record<ToastType, { bg: string; border: string; icon: string; iconName: keyof typeof Ionicons.glyphMap }> = {
  success: { bg: COLORS.success, border: COLORS.successDark, icon: '#FFFFFF', iconName: 'checkmark-circle' },
  error: { bg: COLORS.error, border: COLORS.errorDark, icon: '#FFFFFF', iconName: 'alert-circle' },
  info: { bg: '#1E293B', border: '#334155', icon: '#94A3B8', iconName: 'information-circle' },
};

function ToastItem({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const colors = ToastColors[toast.type];
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, translateY]);

  return (
    <Animated.View
      style={[
        styles.toast,
        { backgroundColor: colors.bg, borderColor: colors.border, opacity: fadeAnim, transform: [{ translateY }] },
      ]}
    >
      <Ionicons name={colors.iconName} size={20} color={colors.icon} />
      <Text style={[styles.toastText, { color: colors.icon }]}>{toast.message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 9999,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  toastText: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
});
