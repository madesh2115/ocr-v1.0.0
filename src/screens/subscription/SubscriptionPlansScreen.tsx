import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY } from '../../theme/designSystem';
import { getApiBaseUrl } from '../../utils/apiConfig';

interface Plan {
  id: number;
  name: string;
  description: string;
  price: number;
  duration_days: number;
  features: string[];
}

interface Props {
  navigation: any;
}

export function SubscriptionPlansScreen({ navigation }: Props) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    fetchPlans();
  }, []);

  const fetchPlans = async () => {
    try {
      const API_URL = getApiBaseUrl();
      const response = await fetch(`${API_URL}/api/subscriptions/plans`);
      const data = await response.json();
      if (data.success) {
        setPlans(data.data);
        // Select free plan by default
        const freePlan = data.data.find((p: Plan) => p.price === 0);
        if (freePlan) setSelectedPlan(freePlan.id);
      }
    } catch (error) {
      console.error('Failed to fetch plans:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPlan = (planId: number) => {
    setSelectedPlan(planId);
  };

  const handleSubscribe = async () => {
    if (!selectedPlan) {
      Alert.alert('Select Plan', 'Please select a subscription plan to continue.');
      return;
    }

    const plan = plans.find(p => p.id === selectedPlan);
    if (!plan) return;

    if (plan.price === 0) {
      // Free plan - activate directly
      Alert.alert('Free Plan', 'The free plan has been activated.');
      navigation.goBack();
      return;
    }

    // Navigate to gateway selection
    navigation.navigate('GatewaySelection', {
      planId: selectedPlan,
      amount: plan.price,
      planName: plan.name,
    });
  };

  const isPopular = (planName: string) => {
    return planName.toLowerCase() === 'premium';
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading plans...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Subscription Plans</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Section */}
        <View style={styles.heroSection}>
          <Text style={styles.heroTitle}>Unlock Premium Features</Text>
          <Text style={styles.heroSubtitle}>
            Choose a plan that fits your needs. Upgrade or downgrade anytime.
          </Text>
        </View>

        {/* Plan Cards */}
        <View style={styles.plansContainer}>
          {plans.map((plan) => {
            const isSelected = selectedPlan === plan.id;
            const popular = isPopular(plan.name);

            return (
              <TouchableOpacity
                key={plan.id}
                style={[
                  styles.planCard,
                  isSelected && styles.planCardSelected,
                ]}
                onPress={() => handleSelectPlan(plan.id)}
                activeOpacity={0.7}
              >
                {/* Popular Badge */}
                {popular && (
                  <View style={styles.popularBadge}>
                    <Ionicons name="star" size={12} color={COLORS.surface} />
                    <Text style={styles.popularText}>MOST POPULAR</Text>
                  </View>
                )}

                {/* Plan Header */}
                <View style={styles.planHeader}>
                  <View style={styles.planInfo}>
                    <Text style={styles.planName}>{plan.name}</Text>
                    <View style={styles.priceContainer}>
                      <Text style={[styles.price, isSelected && styles.priceSelected]}>
                        {plan.price === 0 ? 'Free' : `₹${plan.price}`}
                      </Text>
                      {plan.price > 0 && (
                        <Text style={styles.duration}>/ {plan.duration_days} days</Text>
                      )}
                    </View>
                  </View>

                  {/* Selection Indicator */}
                  <View style={[styles.radioOuter, isSelected && styles.radioOuterSelected]}>
                    {isSelected && <View style={styles.radioInner} />}
                  </View>
                </View>

                {/* Description */}
                <Text style={styles.planDescription}>{plan.description}</Text>

                {/* Features */}
                <View style={styles.featuresList}>
                  {plan.features?.map((feature, index) => {
                    const isIncluded = !feature.startsWith('NO_') && !feature.includes('_NOT');
                    const featureText = feature
                      .replace('NO_', '')
                      .replace(/_/g, ' ')
                      .toLowerCase();

                    return (
                      <View key={index} style={styles.featureItem}>
                        <Ionicons
                          name={isIncluded ? 'checkmark-circle' : 'close-circle'}
                          size={18}
                          color={isIncluded ? COLORS.success : COLORS.textTertiary}
                        />
                        <Text
                          style={[
                            styles.featureText,
                            !isIncluded && styles.featureTextExcluded,
                          ]}
                        >
                          {featureText}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Bottom CTA */}
      <View style={styles.bottomContainer}>
        <TouchableOpacity
          style={[styles.ctaButton, !selectedPlan && styles.ctaButtonDisabled]}
          onPress={handleSubscribe}
          activeOpacity={0.8}
        >
          <Text style={styles.ctaButtonText}>
            {selectedPlan
              ? `Continue with ${plans.find(p => p.id === selectedPlan)?.name}`
              : 'Select a Plan'}
          </Text>
          <Ionicons name="arrow-forward" size={20} color={COLORS.surface} />
        </TouchableOpacity>

        {/* Trust Indicators */}
        <View style={styles.trustIndicators}>
          <View style={styles.trustItem}>
            <Ionicons name="shield-checkmark" size={16} color={COLORS.success} />
            <Text style={styles.trustText}>Secure payment</Text>
          </View>
          <View style={styles.trustItem}>
            <Ionicons name="refresh-circle" size={16} color={COLORS.success} />
            <Text style={styles.trustText}>Cancel anytime</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  loadingText: {
    marginTop: SPACING.md,
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.xl + SPACING.md,
    paddingBottom: SPACING.md,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
  },
  headerRight: {
    width: 44,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  heroSection: {
    paddingVertical: SPACING.lg,
    alignItems: 'center',
  },
  heroTitle: {
    ...TYPOGRAPHY.h1,
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  heroSubtitle: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
    paddingHorizontal: SPACING.lg,
  },
  plansContainer: {
    gap: SPACING.md,
  },
  planCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 2,
    borderColor: COLORS.border,
    position: 'relative',
  },
  planCardSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
  },
  popularBadge: {
    position: 'absolute',
    top: -12,
    left: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.warning,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.sm,
    gap: SPACING.xs,
  },
  popularText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.surface,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.sm,
  },
  planInfo: {
    flex: 1,
  },
  planName: {
    ...TYPOGRAPHY.h2,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: SPACING.xs,
  },
  price: {
    fontSize: 32,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  priceSelected: {
    color: COLORS.primary,
  },
  duration: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textSecondary,
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: {
    borderColor: COLORS.primary,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.primary,
  },
  planDescription: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textSecondary,
    marginBottom: SPACING.md,
  },
  featuresList: {
    gap: SPACING.sm,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  featureText: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textPrimary,
    flex: 1,
  },
  featureTextExcluded: {
    color: COLORS.textTertiary,
    textDecorationLine: 'line-through',
  },
  bottomContainer: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xl,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  ctaButton: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  ctaButtonDisabled: {
    backgroundColor: COLORS.textTertiary,
  },
  ctaButtonText: {
    ...TYPOGRAPHY.body,
    color: COLORS.surface,
    fontWeight: '600',
  },
  trustIndicators: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: SPACING.md,
    gap: SPACING.lg,
  },
  trustItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  trustText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
});
