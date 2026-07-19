import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ConfidenceBannerProps {
  confidence: number;
}

export function ConfidenceBanner({ confidence }: ConfidenceBannerProps) {
  if (confidence >= 0.70) return null;

  return (
    <View style={styles.banner}>
      <Ionicons name="warning-outline" size={18} color="#92400E" />
      <Text style={styles.text}>
        Low confidence ({Math.round(confidence * 100)}%). Please verify extracted data manually.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#92400E',
    lineHeight: 18,
  },
});
