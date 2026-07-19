import React, { useEffect, useState, useCallback } from 'react';
import { ActivityIndicator, View, StyleSheet, Pressable, Platform, Text } from 'react-native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnboardingScreen } from '../screens/onboarding/OnboardingScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { RegisterScreen } from '../screens/auth/RegisterScreen';
import { ForgotPasswordScreen } from '../screens/auth/ForgotPasswordScreen';
import { DashboardScreen } from '../screens/dashboard/DashboardScreen';
import { AddManualExpenseScreen } from '../screens/dashboard/AddManualExpenseScreen';
import { ScanScreen } from '../screens/ScanScreen';
import { CropScreen } from '../screens/CropScreen';
import { ExtractingScreen } from '../screens/ExtractingScreen';
import { ResultScreen } from '../screens/ResultScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { SavedDocumentsScreen } from '../screens/SavedDocumentsScreen';
import { DocumentsListScreen } from '../screens/documents/DocumentsListScreen';
import { DocumentDetailScreen } from '../screens/documents/DocumentDetailScreen';
import { AnalyticsScreen } from '../screens/analytics/AnalyticsScreen';
import { ProfileScreen } from '../screens/profile/ProfileScreen';
import { OrganizationSettingsScreen } from '../screens/profile/OrganizationSettingsScreen';
import { SettingsScreen } from '../screens/profile/SettingsScreen';
import { SubscriptionPlansScreen } from '../screens/subscription/SubscriptionPlansScreen';
import { SubscriptionStatusScreen } from '../screens/subscription/SubscriptionStatusScreen';
import { PaymentScreen } from '../screens/subscription/PaymentScreen';
import { GatewaySelectionScreen } from '../screens/subscription/GatewaySelectionScreen';
import { PaymentProcessingScreen } from '../screens/subscription/PaymentProcessingScreen';

import { useAuth } from '../context/AuthContext';

const ONBOARDING_COMPLETED_KEY = '@onboarding_completed';

// Auth Stack Navigator
type AuthStackParamList = { Login: undefined; Register: undefined; ForgotPassword: undefined };
const AuthStack = createStackNavigator<AuthStackParamList>();

function AuthStackNavigator() {
  return (
    <AuthStack.Navigator
      screenOptions={{
        headerShown: false,
        cardStyle: { backgroundColor: '#F8FAFC' },
      }}
    >
      <AuthStack.Screen name="Login" component={LoginScreen as any} />
      <AuthStack.Screen name="Register" component={RegisterScreen as any} />
      <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen as any} />
    </AuthStack.Navigator>
  );
}

// Onboarding Stack Navigator
type OnboardingStackParamList = { Onboarding: undefined };
const OnboardingStack = createStackNavigator<OnboardingStackParamList>();

function OnboardingStackNavigator({ onComplete }: { onComplete?: () => void }) {
  return (
    <OnboardingStack.Navigator
      screenOptions={{
        headerShown: false,
        cardStyle: { backgroundColor: '#F8FAFC' },
      }}
    >
      <OnboardingStack.Screen name="Onboarding">
        {(screenProps) => <OnboardingScreen {...screenProps} onComplete={onComplete} />}
      </OnboardingStack.Screen>
    </OnboardingStack.Navigator>
  );
}

// Main Tab Navigator
const Tab = createBottomTabNavigator();

// OCR Stack Navigator (inside the Scan tab)
type OCRStackParamList = {
  ScanHome: undefined;
  Crop: { imageUri: string };
  Extracting: { imageUri: string; cropBox: any };
  Result: { result: any; imageUri: string };
  Home: undefined;
  SavedDocuments: undefined;
};
const OCRStackNav = createStackNavigator<OCRStackParamList>();

function OCRStackNavigator() {
  return (
    <OCRStackNav.Navigator
      screenOptions={{
        headerShown: false,
        cardStyle: { backgroundColor: '#F8FAFC' },
      }}
    >
      <OCRStackNav.Screen name="ScanHome" component={ScanScreen as any} />
      <OCRStackNav.Screen name="Crop" component={CropScreen as any} />
      <OCRStackNav.Screen name="Extracting" component={ExtractingScreen as any} />
      <OCRStackNav.Screen name="Result" component={ResultScreen as any} />
      <OCRStackNav.Screen name="Home" component={HomeScreen as any} />
      <OCRStackNav.Screen name="SavedDocuments" component={SavedDocumentsScreen as any} />
    </OCRStackNav.Navigator>
  );
}

// Dashboard Stack Navigator (inside the Dashboard tab)
type DashboardStackParamList = {
  DashboardHome: undefined;
  AddManualExpense: undefined;
};
const DashboardStackNav = createStackNavigator<DashboardStackParamList>();

function DashboardStackNavigator() {
  return (
    <DashboardStackNav.Navigator
      screenOptions={{
        headerShown: false,
        cardStyle: { backgroundColor: '#F8FAFC' },
      }}
    >
      <DashboardStackNav.Screen name="DashboardHome" component={DashboardScreen as any} />
      <DashboardStackNav.Screen name="AddManualExpense" component={AddManualExpenseScreen as any} />
    </DashboardStackNav.Navigator>
  );
}

// Documents Stack Navigator (inside the Documents tab)
type DocumentsStackParamList = {
  DocumentsList: undefined;
  DocumentDetail: { documentId: number };
};
const DocumentsStackNav = createStackNavigator<DocumentsStackParamList>();

function DocumentsStackNavigator() {
  return (
    <DocumentsStackNav.Navigator
      screenOptions={{
        headerShown: false,
        cardStyle: { backgroundColor: '#F8FAFC' },
      }}
    >
      <DocumentsStackNav.Screen name="DocumentsList" component={DocumentsListScreen as any} />
      <DocumentsStackNav.Screen name="DocumentDetail" component={DocumentDetailScreen as any} />
    </DocumentsStackNav.Navigator>
  );
}

// Profile Stack Navigator (inside the Profile tab)
type ProfileStackParamList = {
  ProfileHome: undefined;
  OrganizationSettings: undefined;
  Settings: undefined;
  SubscriptionPlans: undefined;
  SubscriptionStatus: undefined;
  Payment: { orderId: string; paymentUrl: string; amount: number; planName: string };
  GatewaySelection: { planId: number; amount: number; planName: string };
  PaymentProcessing: {
    gateway: string;
    orderId: string;
    paymentUrl?: string;
    razorpayOrderId?: string;
    razorpayKeyId?: string;
    cashfreeOrderId?: string;
    cfToken?: string;
    clientId?: string;
    amount: number;
    planName: string;
  };
};
const ProfileStackNav = createStackNavigator<ProfileStackParamList>();

function ProfileStackNavigator() {
  return (
    <ProfileStackNav.Navigator
      screenOptions={{
        headerShown: false,
        cardStyle: { backgroundColor: '#F8FAFC' },
      }}
    >
      <ProfileStackNav.Screen name="ProfileHome" component={ProfileScreen as any} />
      <ProfileStackNav.Screen name="OrganizationSettings" component={OrganizationSettingsScreen as any} />
      <ProfileStackNav.Screen name="Settings" component={SettingsScreen as any} />
      <ProfileStackNav.Screen name="SubscriptionPlans" component={SubscriptionPlansScreen as any} />
      <ProfileStackNav.Screen name="SubscriptionStatus" component={SubscriptionStatusScreen as any} />
      <ProfileStackNav.Screen
        name="Payment"
        component={PaymentScreen as any}
        options={{ presentation: 'modal' }}
      />
      <ProfileStackNav.Screen
        name="GatewaySelection"
        component={GatewaySelectionScreen as any}
      />
      <ProfileStackNav.Screen
        name="PaymentProcessing"
        component={PaymentProcessingScreen as any}
      />
    </ProfileStackNav.Navigator>
  );
}

// Custom Tab Bar with centered Scan button
function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, 8);

  const getIconName = (routeName: string, isFocused: boolean): keyof typeof Ionicons.glyphMap => {
    const icons: Record<string, { focused: keyof typeof Ionicons.glyphMap; unfocused: keyof typeof Ionicons.glyphMap }> = {
      Dashboard: { focused: 'home', unfocused: 'home-outline' },
      Scan: { focused: 'camera', unfocused: 'camera-outline' },
      Documents: { focused: 'document-text', unfocused: 'document-text-outline' },
      Analytics: { focused: 'bar-chart', unfocused: 'bar-chart-outline' },
      Profile: { focused: 'person', unfocused: 'person-outline' },
    };
    return isFocused ? icons[routeName]?.focused || 'help' : icons[routeName]?.unfocused || 'help-outline';
  };

  const navigateToTab = useCallback((routeName: string) => {
    navigation.navigate(routeName);
  }, [navigation]);

  const renderTab = (routeName: string, label: string) => {
    const currentRouteName = state.routes[state.index]?.name;
    const isFocused = currentRouteName === routeName;
    const iconName = getIconName(routeName, isFocused);

    return (
      <Pressable
        key={routeName}
        style={tabStyles.tabButton}
        onPress={() => navigateToTab(routeName)}
      >
        <Ionicons name={iconName} size={24} color={isFocused ? '#6366F1' : '#94A3B8'} />
        <Text style={[tabStyles.tabLabel, isFocused && tabStyles.tabLabelActive]}>
          {label}
        </Text>
        {isFocused && <View style={tabStyles.activeIndicator} />}
      </Pressable>
    );
  };

  return (
    <View style={[tabStyles.container, { paddingBottom: bottomPadding }]}>
      <View style={tabStyles.bar}>
        {/* Left tabs */}
        <View style={tabStyles.leftTabs}>
          {renderTab('Dashboard', 'Home')}
          {renderTab('Analytics', 'Analytics')}
        </View>

        {/* Center Scan Button */}
        <View style={tabStyles.centerContainer}>
          <Pressable
            style={({ pressed }) => [
              tabStyles.scanButton,
              pressed && tabStyles.scanButtonPressed,
            ]}
            onPress={() => navigateToTab('Scan')}
          >
            <View style={tabStyles.scanButtonInner}>
              <Ionicons name="camera" size={30} color="#FFFFFF" />
            </View>
          </Pressable>
        </View>

        {/* Right tabs */}
        <View style={tabStyles.rightTabs}>
          {renderTab('Documents', 'Docs')}
          {renderTab('Profile', 'Profile')}
        </View>
      </View>
    </View>
  );
}

const tabStyles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    zIndex: 999,
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.04,
        shadowRadius: 10,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    minHeight: 56,
  },
  leftTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  rightTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  tabButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    minWidth: 64,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 4,
  },
  tabLabelActive: {
    color: '#6366F1',
    fontWeight: '600',
  },
  activeIndicator: {
    position: 'absolute',
    bottom: -2,
    width: 16,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#6366F1',
  },
  centerContainer: {
    position: 'absolute',
    top: -28,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    pointerEvents: 'box-none',
  },
  cameraTouchable: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanButtonPressed: {
    transform: [{ scale: 0.95 }],
  },
  scanButtonInner: {
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: '#6366F1',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    ...Platform.select({
      ios: {
        shadowColor: '#6366F1',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
      },
      android: {
        elevation: 8,
      },
    }),
  },
});

function MainTabNavigator() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap;
          switch (route.name) {
            case 'Dashboard':
              iconName = focused ? 'home' : 'home-outline';
              break;
            case 'Scan':
              iconName = focused ? 'camera' : 'camera-outline';
              break;
            case 'Documents':
              iconName = focused ? 'document-text' : 'document-text-outline';
              break;
            case 'Analytics':
              iconName = focused ? 'bar-chart' : 'bar-chart-outline';
              break;
            case 'Profile':
              iconName = focused ? 'person' : 'person-outline';
              break;
            default:
              iconName = 'help-outline';
          }
          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#6366F1',
        tabBarInactiveTintColor: '#64748B',
        tabBarStyle: {
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
        headerShown: true,
        headerStyle: {
          backgroundColor: '#FFFFFF',
          borderBottomWidth: 1,
          borderBottomColor: '#F1F5F9',
          shadowOpacity: 0,
          elevation: 0,
        },
        headerTintColor: '#0F172A',
        headerTitleStyle: {
          fontWeight: '700',
          fontSize: 18,
        },
      })}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardStackNavigator}
        options={{ title: 'Dashboard', tabBarLabel: 'Home' }}
      />
      <Tab.Screen
        name="Scan"
        component={OCRStackNavigator}
        options={{ title: 'Scan Receipt', tabBarLabel: 'Scan' }}
      />
      <Tab.Screen
        name="Documents"
        component={DocumentsStackNavigator}
        options={{ title: 'Documents', tabBarLabel: 'Documents' }}
      />
      <Tab.Screen
        name="Analytics"
        component={AnalyticsScreen}
        options={{ title: 'Analytics', tabBarLabel: 'Analytics' }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileStackNavigator}
        options={{ title: 'Profile', tabBarLabel: 'Profile' }}
      />
    </Tab.Navigator>
  );
}

// Root Stack Navigator
const RootStack = createStackNavigator();

function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    checkOnboardingStatus();
  }, []);

  const checkOnboardingStatus = async () => {
    try {
      const value = await AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY);
      setHasSeenOnboarding(value === 'true');
    } catch (error) {
      setHasSeenOnboarding(false);
    }
  };

  if (isLoading || hasSeenOnboarding === null) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6366F1" />
      </View>
    );
  }

  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      {!isAuthenticated ? (
        <>
          {!hasSeenOnboarding && (
            <RootStack.Screen name="OnboardingFlow">
              {() => (
                <OnboardingStackNavigator
                  onComplete={() => setHasSeenOnboarding(true)}
                />
              )}
            </RootStack.Screen>
          )}
          <RootStack.Screen name="AuthFlow" component={AuthStackNavigator} />
        </>
      ) : (
        <RootStack.Screen name="MainFlow" component={MainTabNavigator} />
      )}
    </RootStack.Navigator>
  );
}

export function AppNavigator() {
  return <RootNavigator />;
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
});
