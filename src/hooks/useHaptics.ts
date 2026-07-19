import * as Haptics from 'expo-haptics';

export type HapticType = 'light' | 'medium' | 'selection' | 'success' | 'warning' | 'error';

export const triggerHaptic = (type: HapticType = 'light') => {
  switch (type) {
    case 'light':
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      break;
    case 'medium':
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      break;
    case 'selection':
      Haptics.selectionAsync();
      break;
    case 'success':
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      break;
    case 'warning':
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      break;
    case 'error':
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      break;
  }
};
