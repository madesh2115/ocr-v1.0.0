import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

// API Base URL resolution
const getApiBaseUrl = (): string => {
  if (Constants.expoConfig?.extra?.apiBaseUrl) {
    return Constants.expoConfig.extra.apiBaseUrl;
  }
  if (Constants.manifest?.hostUri) {
    const host = Constants.manifest.hostUri.split(':')[0];
    return `http://${host}:5000`;
  }
  return 'http://127.0.0.1:5000';
};

const API_URL = getApiBaseUrl();

export interface Plan {
  id: number;
  name: string;
  description: string;
  price: number;
  duration_days: number;
  features: string[];
  is_active: boolean;
}

export interface Subscription {
  id: number;
  status: 'active' | 'cancelled' | 'expired';
  start_date: string;
  end_date: string;
  plan_id: number;
  plan_name: string;
  price: number;
}

export interface SubscriptionStatus {
  has_active_subscription: boolean;
  subscription: Subscription | null;
}

export interface CreateOrderResponse {
  order_id: string;
  payment_url: string | null;
  merchant_transaction_id: string;
}

// Get auth headers
async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  try {
    const userStr = await SecureStore.getItemAsync('user');
    if (userStr) {
      const user = JSON.parse(userStr);
      headers['X-User-Id'] = user.id.toString();
    }
  } catch (error) {
    console.error('Error getting user for headers:', error);
  }

  return headers;
}

// Fetch subscription plans
export async function getPlans(): Promise<Plan[]> {
  try {
    const response = await fetch(`${API_URL}/api/subscriptions/plans`);
    const data = await response.json();

    if (data.success) {
      return data.data;
    }
    throw new Error(data.error?.message || 'Failed to fetch plans');
  } catch (error) {
    console.error('Error fetching plans:', error);
    throw error;
  }
}

// Get current subscription status
export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_URL}/api/subscriptions/status`, {
      headers,
    });
    const data = await response.json();

    if (data.success) {
      return data.data;
    }
    throw new Error(data.error?.message || 'Failed to fetch subscription status');
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    throw error;
  }
}

// Get user's subscription history
export async function getMySubscriptions(): Promise<Subscription[]> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_URL}/api/subscriptions/my`, {
      headers,
    });
    const data = await response.json();

    if (data.success) {
      return data.data;
    }
    throw new Error(data.error?.message || 'Failed to fetch subscriptions');
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    throw error;
  }
}

// Create payment order
export async function createSubscriptionOrder(
  planId: number,
  redirectUrl?: string
): Promise<CreateOrderResponse> {
  try {
    const headers = await getAuthHeaders();
    const userId = headers['X-User-Id'];

    if (!userId) {
      throw new Error('User not authenticated');
    }

    const response = await fetch(`${API_URL}/api/subscriptions/create-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: parseInt(userId),
        plan_id: planId,
        redirect_url: redirectUrl || 'myapp://subscription/callback',
      }),
    });
    const data = await response.json();

    if (data.success) {
      return data.data;
    }
    throw new Error(data.error?.message || 'Failed to create order');
  } catch (error) {
    console.error('Error creating order:', error);
    throw error;
  }
}

// Check payment status
export async function checkPaymentStatus(orderId: string): Promise<{ status: string; failure_reason?: string }> {
  try {
    const response = await fetch(`${API_URL}/api/subscriptions/check-payment/${orderId}`);
    const data = await response.json();

    if (data.success) {
      return data.data;
    }
    throw new Error(data.error?.message || 'Failed to check payment status');
  } catch (error) {
    console.error('Error checking payment status:', error);
    throw error;
  }
}

// Cancel subscription
export async function cancelSubscription(subscriptionId: number): Promise<void> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_URL}/api/subscriptions/cancel/${subscriptionId}`, {
      method: 'POST',
      headers,
    });
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error?.message || 'Failed to cancel subscription');
    }
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    throw error;
  }
}

// Check if user has premium access
export async function hasPremiumAccess(): Promise<boolean> {
  try {
    const status = await getSubscriptionStatus();
    return status.has_active_subscription;
  } catch (error) {
    console.error('Error checking premium access:', error);
    return false;
  }
}
