import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { useNavigation, useRoute } from '@react-navigation/native';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY } from '../../theme/designSystem';
import { getApiBaseUrl } from '../../utils/apiConfig';

interface Props {
  navigation: any;
  route: any;
}

export function PaymentProcessingScreen({ navigation, route }: Props) {
  const {
    gateway,
    orderId,
    paymentUrl,
    razorpayOrderId,
    razorpayKeyId,
    cashfreeOrderId,
    cfToken,
    clientId,
    amount,
    planName,
  } = route.params;

  const [paymentStatus, setPaymentStatus] = useState<'pending' | 'processing' | 'success' | 'failed'>('pending');
  const [showWebView, setShowWebView] = useState(false);

  const API_URL = getApiBaseUrl();

  useEffect(() => {
    if (gateway === 'razorpay' && razorpayKeyId) {
      // For Razorpay, we can use their SDK or redirect
      // For simplicity, we'll use a web redirect
      checkPaymentStatus();
    } else if (gateway === 'cashfree' && cashfreeOrderId) {
      checkPaymentStatus();
    } else if (paymentUrl) {
      // PhonePe - open payment URL
      setShowWebView(true);
    }
  }, []);

  const checkPaymentStatus = async () => {
    try {
      const endpoint =
        gateway === 'razorpay'
          ? `${API_URL}/api/subscriptions/razorpay/verify-payment`
          : gateway === 'cashfree'
          ? `${API_URL}/api/subscriptions/cashfree/verify-payment`
          : `${API_URL}/api/subscriptions/check-payment/${orderId}`;

      // For now, poll check-payment endpoint
      const response = await fetch(`${API_URL}/api/subscriptions/check-payment/${orderId}`);
      const data = await response.json();

      if (data.success) {
        if (data.data.status === 'completed') {
          setPaymentStatus('success');
          Alert.alert(
            'Payment Successful!',
            `Your ${planName} subscription is now active.`,
            [{ text: 'OK', onPress: () => navigation.navigate('Home') }]
          );
        } else if (data.data.status === 'failed') {
          setPaymentStatus('failed');
          Alert.alert(
            'Payment Failed',
            data.data.failure_reason || 'Please try again.',
            [{ text: 'OK', onPress: () => navigation.goBack() }]
          );
        }
      }
    } catch (error) {
      console.error('Error checking payment:', error);
    }
  };

  const handleOpenExternal = () => {
    if (paymentUrl) {
      Linking.openURL(paymentUrl);
    } else if (gateway === 'razorpay') {
      // For Razorpay, construct payment URL
      const razorpayUrl = `https://rzp.io/i/${razorpayOrderId}`;
      Linking.openURL(razorpayUrl);
    }
  };

  const handleRazorpayVerify = async (paymentId: string, signature: string) => {
    try {
      const response = await fetch(`${API_URL}/api/subscriptions/razorpay/verify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: razorpayOrderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: signature,
        }),
      });

      const data = await response.json();
      if (data.success) {
        setPaymentStatus('success');
        Alert.alert('Success', 'Subscription activated!', [
          { text: 'OK', onPress: () => navigation.navigate('Home') },
        ]);
      }
    } catch (error) {
      console.error('Verification error:', error);
    }
  };

  if (paymentStatus === 'success') {
    return (
      <View style={styles.container}>
        <View style={styles.statusContainer}>
          <Ionicons name="checkmark-circle" size={80} color={COLORS.success} />
          <Text style={styles.statusTitle}>Payment Successful!</Text>
          <Text style={styles.statusSubtitle}>Your subscription is now active</Text>
        </View>
      </View>
    );
  }

  if (paymentStatus === 'failed') {
    return (
      <View style={styles.container}>
        <View style={styles.statusContainer}>
          <Ionicons name="close-circle" size={80} color={COLORS.error} />
          <Text style={styles.statusTitle}>Payment Failed</Text>
          <Text style={styles.statusSubtitle}>Please try again later</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.retryButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
          <Ionicons name="close" size={28} color={COLORS.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Complete Payment</Text>
        <View style={styles.placeholder} />
      </View>

      <View style={styles.orderInfo}>
        <Text style={styles.orderLabel}>Order Summary</Text>
        <Text style={styles.planName}>{planName} Subscription</Text>
        <Text style={styles.amount}>₹{amount}</Text>
      </View>

      <View style={styles.gatewayInfo}>
        <Text style={styles.gatewayTitle}>Payment Gateway</Text>
        <View style={styles.gatewayRow}>
          <Ionicons
            name={gateway === 'razorpay' ? 'wallet' : gateway === 'cashfree' ? 'cash' : 'card'}
            size={24}
            color={COLORS.primary}
          />
          <Text style={styles.gatewayName}>
            {gateway.charAt(0).toUpperCase() + gateway.slice(1)}
          </Text>
        </View>
      </View>

      <View style={styles.actionContainer}>
        <TouchableOpacity style={styles.browserButton} onPress={handleOpenExternal}>
          <Ionicons name="browsers-outline" size={24} color="#FFF" />
          <Text style={styles.browserButtonText}>Open Payment Gateway</Text>
        </TouchableOpacity>

        <Text style={styles.orText}>OR</Text>

        <TouchableOpacity
          style={styles.webviewButton}
          onPress={() => setShowWebView(!showWebView)}
        >
          <Ionicons name="globe-outline" size={24} color={COLORS.primary} />
          <Text style={styles.webviewButtonText}>
            {showWebView ? 'Hide Web View' : 'Pay In-App'}
          </Text>
        </TouchableOpacity>
      </View>

      {showWebView && paymentUrl && (
        <View style={styles.webviewContainer}>
          <WebView
            source={{ uri: paymentUrl }}
            style={styles.webview}
            onNavigationStateChange={(navState) => {
              if (navState.url.includes('success') || navState.url.includes('callback')) {
                checkPaymentStatus();
              }
            }}
            onError={() => {
              Alert.alert('Error', 'Failed to load payment page');
            }}
          />
        </View>
      )}

      <View style={styles.pollingInfo}>
        <ActivityIndicator size="small" color={COLORS.primary} />
        <Text style={styles.pollingText}>
          Checking payment status...
        </Text>
      </View>

      <View style={styles.footer}>
        <Ionicons name="shield-checkmark" size={20} color={COLORS.success} />
        <Text style={styles.footerText}>
          Your payment is secured by {gateway.charAt(0).toUpperCase() + gateway.slice(1)}
        </Text>
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
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  closeButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  placeholder: {
    width: 32,
  },
  orderInfo: {
    backgroundColor: COLORS.surface,
    margin: 16,
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
  },
  orderLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  planName: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  amount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  gatewayInfo: {
    backgroundColor: COLORS.surface,
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  gatewayTitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  gatewayRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  gatewayName: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.textPrimary,
    marginLeft: 12,
  },
  actionContainer: {
    padding: 16,
  },
  browserButton: {
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  browserButtonText: {
    color: COLORS.textInverse,
    fontSize: 16,
    fontWeight: '600',
  },
  orText: {
    textAlign: 'center',
    color: COLORS.textTertiary,
    marginVertical: 16,
  },
  webviewButton: {
    backgroundColor: COLORS.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.primary,
    gap: 12,
  },
  webviewButtonText: {
    color: COLORS.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  webviewContainer: {
    flex: 1,
    margin: 16,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  webview: {
    flex: 1,
  },
  statusContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  statusTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginTop: 24,
    marginBottom: 8,
  },
  statusSubtitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    marginTop: 24,
  },
  retryButtonText: {
    color: COLORS.textInverse,
    fontSize: 16,
    fontWeight: '600',
  },
  pollingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 8,
  },
  pollingText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    paddingBottom: 100,
    gap: 8,
  },
  footerText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
});
