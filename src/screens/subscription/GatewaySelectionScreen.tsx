import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY } from '../../theme/designSystem';
import { getApiBaseUrl } from '../../utils/apiConfig';

type Gateway = 'phonepe' | 'razorpay' | 'cashfree';

interface GatewayInfo {
  id: Gateway;
  name: string;
  icon: string;
  color: string;
  description: string;
}

const GATEWAYS: GatewayInfo[] = [
  {
    id: 'phonepe',
    name: 'PhonePe',
    icon: 'card',
    color: '#FF6F00',
    description: 'Fast & secure payments with PhonePe',
  },
  {
    id: 'razorpay',
    name: 'Razorpay',
    icon: 'wallet',
    color: '#2B2B2B',
    description: 'India\'s most trusted payment gateway',
  },
  {
    id: 'cashfree',
    name: 'Cashfree',
    icon: 'cash',
    color: '#00A676',
    description: 'Simple and smooth payment experience',
  },
];

interface Props {
  navigation: any;
  route: any;
}

export function GatewaySelectionScreen({ navigation, route }: Props) {
  const { planId, amount, planName } = route.params;
  const [selectedGateway, setSelectedGateway] = useState<Gateway>('phonepe');
  const [processing, setProcessing] = useState(false);

  const handleContinue = async () => {
    setProcessing(true);
    try {
      const userId = await getUserId();
      const API_URL = getApiBaseUrl();

      const endpoint =
        selectedGateway === 'phonepe'
          ? `${API_URL}/api/subscriptions/create-order`
          : selectedGateway === 'razorpay'
          ? `${API_URL}/api/subscriptions/razorpay/create-order`
          : `${API_URL}/api/subscriptions/cashfree/create-order`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          plan_id: planId,
          redirect_url: 'myapp://subscription/callback',
        }),
      });

      const data = await response.json();

      if (data.success) {
        if (data.data.is_free) {
          Alert.alert('Success', 'Free plan activated!', [
            { text: 'OK', onPress: () => navigation.navigate('Home') },
          ]);
        } else {
          navigation.navigate('PaymentProcessing', {
            gateway: selectedGateway,
            orderId: data.data.order_id,
            paymentUrl: data.data.payment_url,
            razorpayOrderId: data.data.razorpay_order_id,
            razorpayKeyId: data.data.razorpay_key_id,
            cashfreeOrderId: data.data.cashfree_order_id,
            cfToken: data.data.cf_token,
            clientId: data.data.client_id,
            amount,
            planName,
          });
        }
      } else {
        Alert.alert('Error', data.error?.message || 'Failed to create order');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to initiate payment. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const getUserId = async (): Promise<number> => {
    const { default: SecureStore } = await import('expo-secure-store');
    const userStr = await SecureStore.getItemAsync('user');
    if (userStr) {
      const user = JSON.parse(userStr);
      return user.id;
    }
    return 0;
  };

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
        <Text style={styles.headerTitle}>Select Payment Method</Text>
        <View style={styles.headerRight} />
      </View>

      {/* Order Summary */}
      <View style={styles.orderSummary}>
        <View style={styles.orderInfoRow}>
          <Text style={styles.orderLabel}>Plan</Text>
          <Text style={styles.orderValue}>{planName}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.orderInfoRow}>
          <Text style={styles.orderLabel}>Amount</Text>
          <Text style={styles.amount}>₹{amount}</Text>
        </View>
      </View>

      {/* Gateway Selection */}
      <View style={styles.gatewaysContainer}>
        <Text style={styles.sectionTitle}>Choose Payment Gateway</Text>

        {GATEWAYS.map((gateway) => {
          const isSelected = selectedGateway === gateway.id;

          return (
            <TouchableOpacity
              key={gateway.id}
              style={[styles.gatewayCard, isSelected && styles.gatewayCardSelected]}
              onPress={() => setSelectedGateway(gateway.id)}
              activeOpacity={0.7}
            >
              {/* Icon */}
              <View style={[styles.iconContainer, { backgroundColor: gateway.color + '15' }]}>
                <View style={[styles.iconBg, { backgroundColor: gateway.color }]}>
                  <Ionicons name={gateway.icon as any} size={24} color="#FFF" />
                </View>
              </View>

              {/* Info */}
              <View style={styles.gatewayInfo}>
                <Text style={styles.gatewayName}>{gateway.name}</Text>
                <Text style={styles.gatewayDescription}>{gateway.description}</Text>
              </View>

              {/* Radio */}
              <View style={[styles.radio, isSelected && styles.radioSelected]}>
                {isSelected && <View style={styles.radioInner} />}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Security Note */}
      <View style={styles.securityNote}>
        <Ionicons name="shield-checkmark" size={18} color={COLORS.success} />
        <Text style={styles.securityText}>
          All payments are secured with 256-bit encryption
        </Text>
      </View>

      {/* CTA */}
      <View style={styles.bottomContainer}>
        <TouchableOpacity
          style={[styles.ctaButton, processing && styles.ctaButtonDisabled]}
          onPress={handleContinue}
          disabled={processing}
          activeOpacity={0.8}
        >
          {processing ? (
            <ActivityIndicator color={COLORS.surface} />
          ) : (
            <>
              <Text style={styles.ctaButtonText}>Continue to Pay</Text>
              <Text style={styles.ctaButtonAmount}>₹{amount}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  orderSummary: {
    backgroundColor: COLORS.surface,
    margin: SPACING.md,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
  },
  orderInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.xs,
  },
  orderLabel: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
  },
  orderValue: {
    ...TYPOGRAPHY.body,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: SPACING.sm,
  },
  amount: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.primary,
  },
  gatewaysContainer: {
    paddingHorizontal: SPACING.md,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  gatewayCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  gatewayCardSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
  },
  iconContainer: {
    marginRight: SPACING.md,
  },
  iconBg: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gatewayInfo: {
    flex: 1,
  },
  gatewayName: {
    ...TYPOGRAPHY.body,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  gatewayDescription: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: COLORS.primary,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.primary,
  },
  securityNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.lg,
  },
  securityText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  bottomContainer: {
    paddingHorizontal: SPACING.md,
    paddingBottom: 100,
    marginTop: 'auto',
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
    fontWeight: '600',
    color: COLORS.surface,
  },
  ctaButtonAmount: {
    ...TYPOGRAPHY.body,
    fontWeight: '700',
    color: COLORS.surface,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
  },
});
