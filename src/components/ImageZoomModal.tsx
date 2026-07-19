import React from 'react';
import { Modal, View, Image, Pressable, StyleSheet, Dimensions, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface ImageZoomModalProps {
  visible: boolean;
  imageUri: string | null;
  onClose: () => void;
}

export function ImageZoomModal({ visible, imageUri, onClose }: ImageZoomModalProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </Pressable>
          <Text style={styles.headerTitle}>Bill Image</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.imageWrap}>
          {imageUri && (
            <Image
              source={{ uri: imageUri }}
              style={styles.image}
              resizeMode="contain"
            />
          )}
        </View>
        <Pressable
          style={[styles.hint, { paddingBottom: insets.bottom + 16 }]}
          onPress={onClose}
        >
          <Text style={styles.hintText}>Tap anywhere to close</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  imageWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.7,
  },
  hint: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  hintText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
});
