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
import * as SecureStore from 'expo-secure-store';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY } from '../../theme/designSystem';
import { getApiBaseUrl } from '../../utils/apiConfig';

interface Subscription {
  id: number;
  status: 'active' | 'cancelled' | 'expired';
  start_date: string;
  end_date: string;
  plan_id: number;
  plan_name: string;
  price: number;
}

interface Props {
  navigation: any;
}

export function SubscriptionStatusScreen({ navigation }: Props) {
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchSubscriptionStatus();
  }, []);

  const fetchSubscriptionStatus = async () => {
    try {
      const userId = await getUserId();
      if (!userId) {
        navigation.navigate('Login');
        return;
      }

      const API_URL = getApiBaseUrl();
      const response = await fetch(`${API_URL}/api/subscriptions/status`, {
        headers: { 'X-User-Id': userId.toString() },
      });
      const data = await response.json();

      if (data.success && data.data.subscription) {
        setSubscription(data.data.subscription);
      }
    } catch (error) {
      console.error('Failed to fetch subscription:', error);
    } finally {
      setLoading(false);
    }
  };

  const getUserId = async (): Promise<number | null> => {
    try {
      const userStr = await SecureStore.getItemAsync('user');
      if (userStr) {
        const user = JSON.parse(userStr);
        return user.id;
      }
    } catch (error) {
      console.error('Error getting user:', error);
    }
    return null;
  };

  const handleCancelSubscription = () => {
    Alert.alert(
      'Cancel Subscription?',
      'Are you sure? You will lose premium access at the end of your billing period.',
      [
        { text: 'Keep Subscription', style: 'cancel' },
        {
          text: 'Cancel Subscription',
          style: 'destructive',
          onPress: confirmCancel,
        },
      ]
    );
  };

  const confirmCancel = async () => {
    if (!subscription) return;

    setActionLoading(true);
    try {
      const userId = await getUserId();
      const API_URL = getApiBaseUrl();
      const response = await fetch(
        `${API_URL}/api/subscriptions/cancel/${subscription.id}`,
        {
          method: 'POST',
          headers: { 'X-User-Id': userId?.toString() || '' },
        }
      );
      const data = await response.json();

      if (data.success) {
        Alert.alert(
          'Subscription Cancelled',
          'Your subscription has been cancelled. You can resubscribe anytime from the plans page.'
        );
        fetchSubscriptionStatus();
      } else {
        Alert.alert('Error', data.error?.message || 'Failed to cancel');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to cancel subscription');
    } finally {
      setActionLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const getDaysRemaining = () => {
    if (!subscription) return 0;
    const endDate = new Date(subscription.end_date);
    const now = new Date();
    const diff = endDate.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  };

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'active':
        return {
          color: COLORS.success,
          bg: COLORS.successLight,
          icon: 'checkmark-circle',
          label: 'Active',
        };
      case 'cancelled':
        return {
          color: COLORS.warning,
          bg: COLORS.warningLight,
          icon: 'pause-circle',
          label: 'Cancelled',
        };
      case 'expired':
        return {
          color: COLORS.error,
          bg: COLORS.errorLight,
          icon: 'time',
          label: 'Expired',
        };
      default:
        return {
          color: COLORS.textSecondary,
          bg: COLORS.borderLight,
          icon: 'help-circle',
          label: 'Unknown',
        };
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const statusConfig = subscription ? getStatusConfig(subscription.status) : null;

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
        <Text style={styles.headerTitle}>My Subscription</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {subscription ? (
          <>
            {/* Current Plan Card */}
            <View style={styles.planCard}>
              {/* Plan Name & Status */}
              <View style={styles.planHeader}>
                <View style={styles.planInfo}>
                  <Text style={styles.planName}>{subscription.plan_name}</Text>
                  {statusConfig && (
                    <View style={[styles.statusBadge, { backgroundColor: statusConfig.bg }]}>
                      <Ionicons
                        name={statusConfig.icon as any}
                        size={14}
                        color={statusConfig.color}
                      />
                      <Text style={[styles.statusText, { color: statusConfig.color }]}>
                        {statusConfig.label}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={styles.priceContainer}>
                  <Text style={styles.price}>₹{subscription.price}</Text>
                  <Text style={styles.priceLabel}>/ month</Text>
                </View>
              </View>

              {/* Days Remaining (only for active) */}
              {subscription.status === 'active' && (
                <View style={styles.daysRemaining}>
                  <View style={styles.daysInfo}>
                    <Ionicons name="calendar-outline" size={20} color={COLORS.primary} />
                    <Text style={styles.daysText}>
                      {getDaysRemaining()} days remaining
                    </Text>
                  </View>
                  <View style={styles.progressBar}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${Math.min(100, (getDaysRemaining() / 30) * 100)}%`,
                        },
                      ]}
                    />
                  </View>
                </View>
              )}

              {/* Date Info */}
              <View style={styles.dateRow}>
                <View style={styles.dateItem}>
                  <Text style={styles.dateLabel}>Start Date</Text>
                  <Text style={styles.dateValue}>
                    {formatDate(subscription.start_date)}
                  </Text>
                </View>
                <View style={styles.dateDivider} />
                <View style={styles.dateItem}>
                  <Text style={styles.dateLabel}>End Date</Text>
                  <Text style={styles.dateValue}>
                    {formatDate(subscription.end_date)}
                  </Text>
                </View>
              </View>
            </View>

            {/* Features Section */}
            <View style={styles.featuresCard}>
              <Text style={styles.sectionTitle}>Your Premium Features</Text>
              <View style={styles.featuresList}>
                <FeatureItem icon="checkmark-circle" text="Unlimited OCR scans" />
                <FeatureItem icon="checkmark-circle" text="Cloud sync enabled" />
                <FeatureItem icon="checkmark-circle" text="Priority support" />
                <FeatureItem icon="checkmark-circle" text="Export to PDF, CSV, Excel" />
              </View>
            </View>

            {/* Actions */}
            <View style={styles.actionsContainer}>
              {subscription.status === 'active' && (
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={handleCancelSubscription}
                  disabled={actionLoading}
                  activeOpacity={0.7}
                >
                  {actionLoading ? (
                    <ActivityIndicator color={COLORS.error} />
                  ) : (
                    <>
                      <Ionicons name="close-circle-outline" size={20} color={COLORS.error} />
                      <Text style={styles.cancelButtonText}>Cancel Subscription</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.changePlanButton}
                onPress={() => navigation.navigate('SubscriptionPlans')}
                activeOpacity={0.7}
              >
                <Ionicons name="swap-horizontal-outline" size={20} color={COLORS.primary} />
                <Text style={styles.changePlanText}>Change Plan</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          /* No Subscription State */
          <View style={styles.emptyState}>
            <View style={styles.emptyIconContainer}>
              <Ionicons name="ribbon-outline" size={64} color={COLORS.textTertiary} />
            </View>
            <Text style={styles.emptyTitle}>No Active Subscription</Text>
            <Text style={styles.emptyDescription}>
              Subscribe to unlock unlimited OCR scanning, cloud sync, and premium features.
            </Text>

            <TouchableOpacity
              style={styles.subscribeButton}
              onPress={() => navigation.navigate('SubscriptionPlans')}
              activeOpacity={0.8}
            >
              <Text style={styles.subscribeButtonText}>View Plans</Text>
              <Ionicons name="arrow-forward" size={20} color={COLORS.surface} />
            </TouchableOpacity>
          </View>
        )}

        {/* Help Section */}
        <TouchableOpacity style={styles.helpButton} activeOpacity={0.7}>
          <Ionicons name="help-circle-outline" size={20} color={COLORS.textSecondary} />
          <Text style={styles.helpText}>Need help with subscription?</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function FeatureItem({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.featureItem}>
      <Ionicons name={icon as any} size={20} color={COLORS.success} />
      <Text style={styles.featureText}>{text}</Text>
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
    padding: SPACING.md,
    gap: SPACING.md,
    paddingBottom: 100,
  },
  planCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
  },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.md,
  },
  planInfo: {
    flex: 1,
  },
  planName: {
    ...TYPOGRAPHY.h2,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.full,
    alignSelf: 'flex-start',
  },
  statusText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
  },
  priceContainer: {
    alignItems: 'flex-end',
  },
  price: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.primary,
  },
  priceLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  daysRemaining: {
    backgroundColor: COLORS.primaryLight,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  daysInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  daysText: {
    ...TYPOGRAPHY.body,
    fontWeight: '600',
    color: COLORS.primary,
  },
  progressBar: {
    height: 6,
    backgroundColor: COLORS.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 3,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateItem: {
    flex: 1,
    alignItems: 'center',
  },
  dateDivider: {
    width: 1,
    height: 32,
    backgroundColor: COLORS.border,
  },
  dateLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  dateValue: {
    ...TYPOGRAPHY.body,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  featuresCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
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
    ...TYPOGRAPHY.body,
    color: COLORS.textPrimary,
  },
  actionsContainer: {
    gap: SPACING.sm,
  },
  cancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.errorLight,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
  },
  cancelButtonText: {
    ...TYPOGRAPHY.body,
    fontWeight: '600',
    color: COLORS.error,
  },
  changePlanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  changePlanText: {
    ...TYPOGRAPHY.body,
    fontWeight: '600',
    color: COLORS.primary,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: SPACING.xxl,
    paddingHorizontal: SPACING.lg,
  },
  emptyIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
  emptyTitle: {
    ...TYPOGRAPHY.h2,
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  emptyDescription: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.lg,
    lineHeight: 24,
  },
  subscribeButton: {
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
  },
  subscribeButtonText: {
    ...TYPOGRAPHY.body,
    fontWeight: '600',
    color: COLORS.surface,
  },
  helpButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
  },
  helpText: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textSecondary,
  },
});
