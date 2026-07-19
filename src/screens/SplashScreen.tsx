import React, { useEffect } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import Constants from 'expo-constants';
import type { RootStackParamList } from '../types';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY } from '../theme/designSystem';

type Props = StackScreenProps<RootStackParamList, 'Splash'>;

export function SplashScreen({ navigation }: Props) {
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  useEffect(() => {
    const timer = setTimeout(() => {
      navigation.replace('Home');
    }, 1500);
    return () => clearTimeout(timer);
  }, [navigation]);

  return (
    <View style={styles.splash}>
      <Image source={require('../../assets/icon.png')} style={styles.logo} />
      <Text style={styles.title}>OCR V1.00</Text>
      <Text style={styles.sub}>Bill and receipt extraction</Text>
      <Text style={styles.version}>Version {appVersion}</Text>
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
  logo: {
    width: 132,
    height: 132,
    borderRadius: 30,
    marginBottom: 22,
  },
  title: {
    color: COLORS.textInverse,
    fontSize: 34,
    fontWeight: '800',
  },
  sub: {
    color: COLORS.textTertiary,
    fontSize: 16,
    marginTop: 8,
  },
  version: {
    color: COLORS.textTertiary,
    marginTop: 18,
    fontSize: 13,
  },
});
