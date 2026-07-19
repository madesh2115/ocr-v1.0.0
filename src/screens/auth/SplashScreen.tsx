import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY } from '../../theme/designSystem';

type Props = { navigation: any };

export function AuthSplashScreen({ navigation }: Props) {
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      if (isAuthenticated) {
        // User is logged in, go to main app
        navigation.reset({
          index: 0,
          routes: [{ name: 'MainTabs' }],
        });
      } else {
        // User is not logged in, go to login
        navigation.reset({
          index: 0,
          routes: [{ name: 'Login' }],
        });
      }
    }
  }, [isLoading, isAuthenticated, navigation]);

  return (
    <View style={styles.splash}>
      <Text style={styles.title}>OCR V1.00</Text>
      <Text style={styles.subtitle}>Bill and receipt extraction</Text>
      <ActivityIndicator size="large" color={COLORS.primary} style={styles.spinner} />
      <Text style={styles.loadingText}>Loading...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    backgroundColor: COLORS.textPrimary,
  },
  title: {
    color: COLORS.textInverse,
    fontSize: 34,
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    color: COLORS.textTertiary,
    fontSize: 16,
    marginBottom: 40,
  },
  spinner: {
    marginBottom: 16,
  },
  loadingText: {
    color: COLORS.textTertiary,
    fontSize: 14,
  },
});
