import React from 'react';
import { View, Text, Image, ScrollView, StyleSheet, Dimensions, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackScreenProps } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { PrimaryButton } from '../components/PrimaryButton';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY, SHADOWS } from '../theme/designSystem';
import type { RootStackParamList } from '../types';

type Props = StackScreenProps<RootStackParamList, 'Home'>;

export function HomeScreen({ navigation }: Props) {
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Top Bar */}
        <View style={styles.topBar}>
          <Image source={require('../../assets/icon.png')} style={styles.logo} />
          <Text style={styles.versionText}>v{appVersion}</Text>
          <Pressable style={styles.savedBtn} onPress={() => navigation.navigate('SavedDocuments')}>
            <Ionicons name="folder-outline" size={18} color={COLORS.primary} />
            <Text style={styles.savedBtnText}>View Saved</Text>
          </Pressable>
        </View>

        {/* Hero Section */}
        <View style={styles.hero}>
          <View style={styles.heroIconContainer}>
            <Ionicons name="scan-outline" size={48} color={COLORS.primary} />
          </View>
          <Text style={styles.eyebrow}>OCR Receipt Scanner</Text>
          <Text style={styles.title}>Turn receipts into clean data</Text>
          <Text style={styles.body}>
            Capture or upload a bill image, extract the text with Python OCR, and review totals,
            vendor details, dates, tax, line items, and raw OCR text.
          </Text>
        </View>

        {/* Feature Metrics */}
        <View style={styles.statRow}>
          <Metric icon="camera" label="Capture" value="Camera" />
          <Metric icon="cloud-upload-outline" label="Upload" value="Gallery" />
          <Metric icon="receipt-outline" label="Output" value="Formatted" />
        </View>

        {/* CTA Button */}
        <PrimaryButton
          icon="scan-outline"
          label="Start OCR"
          onPress={() => navigation.getParent()?.navigate('Scan')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <View style={styles.metricIconContainer}>
        <Ionicons name={icon} size={22} color={COLORS.primary} />
      </View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { flexGrow: 1, padding: SPACING.lg },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.xl },
  logo: { width: 50, height: 50, borderRadius: RADIUS.md },
  versionText: { ...TYPOGRAPHY.bodySmall, fontWeight: '700', color: COLORS.textSecondary },
  savedBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, backgroundColor: COLORS.primaryLight, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs, borderRadius: RADIUS.sm },
  savedBtnText: { ...TYPOGRAPHY.caption, fontWeight: '700', color: COLORS.primary },
  hero: { alignItems: 'center', marginBottom: SPACING.xl },
  heroIconContainer: { width: 96, height: 96, borderRadius: RADIUS.xl, backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md },
  eyebrow: { ...TYPOGRAPHY.caption, color: COLORS.primary, fontWeight: '800', marginBottom: SPACING.sm, textTransform: 'uppercase', letterSpacing: 1 },
  title: { fontSize: Math.min(36, Dimensions.get('window').width * 0.085), fontWeight: '900', color: COLORS.textPrimary, textAlign: 'center', lineHeight: Math.min(44, Dimensions.get('window').width * 0.1), marginBottom: SPACING.md },
  body: { ...TYPOGRAPHY.body, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 24 },
  statRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.xl },
  metric: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  metricIconContainer: { width: 44, height: 44, borderRadius: RADIUS.sm, backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.sm },
  metricValue: { ...TYPOGRAPHY.body, fontWeight: '800', color: COLORS.textPrimary },
  metricLabel: { ...TYPOGRAPHY.caption, color: COLORS.textSecondary, marginTop: 2 },
});
