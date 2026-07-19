import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Dimensions, FlatList, Pressable, ViewToken } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PrimaryButton } from '../../components/PrimaryButton';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY } from '../../theme/designSystem';

type Props = { navigation: any; onComplete?: () => void };

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface OnboardingPage { id: string; icon: keyof typeof Ionicons.glyphMap; title: string; description: string; }

const PAGES: OnboardingPage[] = [
  { id: '1', icon: 'camera', title: 'Scan Any Receipt', description: 'Point your camera at any bill or receipt and let AI extract the details instantly' },
  { id: '2', icon: 'bar-chart', title: 'Track Your Expenses', description: 'See all your expenses organized by category, date, and vendor' },
  { id: '3', icon: 'people', title: 'Manage Your Team', description: 'Invite your team to share receipts and collaborate on expense reports' },
  { id: '4', icon: 'cloud-done', title: 'Works Offline', description: 'All your data is synced securely across all your devices' },
];

export function OnboardingScreen({ navigation, onComplete }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList<OnboardingPage>>(null);

  const viewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index !== null) setCurrentIndex(viewableItems[0].index);
  }).current;
  const viewConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const handleNext = () => {
    if (currentIndex < PAGES.length - 1) flatListRef.current?.scrollToIndex({ index: currentIndex + 1, animated: true });
  };

  const handleSkip = async () => { await AsyncStorage.setItem('onboarding_complete', 'true'); onComplete?.(); };
  const handleGetStarted = async () => { await AsyncStorage.setItem('onboarding_complete', 'true'); onComplete?.(); };

  const isLastPage = currentIndex === PAGES.length - 1;

  const renderPage = ({ item }: { item: OnboardingPage }) => (
    <View style={styles.pageContainer}>
      <View style={styles.iconContainer}>
        <Ionicons name={item.icon} size={100} color={COLORS.primary} />
      </View>
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.description}>{item.description}</Text>
    </View>
  );

  const renderDot = (index: number) => (
    <View key={index} style={[styles.dot, index === currentIndex && styles.dotActive]} />
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        {!isLastPage && (
          <Pressable onPress={handleSkip} style={styles.skipButton}>
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        )}
      </View>

      <FlatList ref={flatListRef} data={PAGES} renderItem={renderPage} keyExtractor={(item) => item.id}
        horizontal pagingEnabled showsHorizontalScrollIndicator={false} onViewableItemsChanged={viewableItemsChanged}
        viewabilityConfig={viewConfig} bounces={false} />

      <View style={styles.footer}>
        <View style={styles.dotContainer}>{PAGES.map((_, index) => renderDot(index))}</View>
        <PrimaryButton
          label={isLastPage ? 'Get Started' : 'Next'}
          onPress={isLastPage ? handleGetStarted : handleNext}
          icon={isLastPage ? undefined : 'arrow-forward'}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  skipButton: { padding: SPACING.sm },
  skipText: { ...TYPOGRAPHY.body, color: COLORS.textSecondary },
  pageContainer: { width: SCREEN_WIDTH, alignItems: 'center', paddingHorizontal: SPACING.xl, paddingTop: SPACING.xxl },
  iconContainer: { width: 180, height: 180, borderRadius: RADIUS.xl, backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.xl },
  title: { ...TYPOGRAPHY.h1, color: COLORS.textPrimary, textAlign: 'center', marginBottom: SPACING.md },
  description: { ...TYPOGRAPHY.body, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 24 },
  footer: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.lg, gap: SPACING.lg },
  dotContainer: { flexDirection: 'row', justifyContent: 'center', gap: SPACING.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.border },
  dotActive: { width: 24, backgroundColor: COLORS.primary },
});
