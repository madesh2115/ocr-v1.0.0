import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type NetworkStatus = 'checking' | 'online' | 'offline';

interface NetworkStatusBadgeProps {
  status: NetworkStatus;
}

export function NetworkStatusBadge({ status }: NetworkStatusBadgeProps) {
  return (
    <View style={styles.badge}>
      <View
        style={[
          styles.dot,
          status === 'online' && styles.dotOnline,
          status === 'offline' && styles.dotOffline,
          status === 'checking' && styles.dotChecking,
        ]}
      />
      <Text style={styles.text}>
        {status === 'online' ? 'API Connected' : status === 'offline' ? 'API Offline' : 'Checking...'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#94A3B8',
  },
  dotOnline: {
    backgroundColor: '#22C55E',
  },
  dotOffline: {
    backgroundColor: '#EF4444',
  },
  dotChecking: {
    backgroundColor: '#F59E0B',
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
});
