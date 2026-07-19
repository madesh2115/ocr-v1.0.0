import React from 'react';
import { StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

import { DashboardScreen } from '../screens/dashboard/DashboardScreen';
import { ScanScreen } from '../screens/ScanScreen';
import { DocumentsListScreen } from '../screens/documents/DocumentsListScreen';
import { AnalyticsScreen } from '../screens/analytics/AnalyticsScreen';
import { ProfileScreen } from '../screens/profile/ProfileScreen';

type TabParamList = {
  Dashboard: undefined;
  Scan: undefined;
  Documents: undefined;
  Analytics: undefined;
  Profile: undefined;
};
const Tab = createBottomTabNavigator<TabParamList>();

export function MainTabNavigator() {
  return (
    <Tab.Navigator
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
        tabBarInactiveTintColor: '#94A3B8',
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabBarLabel,
        headerShown: true,
        headerStyle: styles.header,
        headerTintColor: '#FFFFFF',
        headerTitleStyle: {
          fontWeight: '600',
        },
      })}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen as any}
        options={{
          title: 'Dashboard',
          tabBarLabel: 'Home',
        }}
      />
      <Tab.Screen
        name="Scan"
        component={ScanScreen as any}
        options={{
          title: 'Scan Receipt',
          tabBarLabel: 'Scan',
        }}
      />
      <Tab.Screen
        name="Documents"
        component={DocumentsListScreen as any}
        options={{
          title: 'Documents',
          tabBarLabel: 'Documents',
        }}
      />
      <Tab.Screen
        name="Analytics"
        component={AnalyticsScreen as any}
        options={{
          title: 'Analytics',
          tabBarLabel: 'Analytics',
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen as any}
        options={{
          title: 'Profile',
          tabBarLabel: 'Profile',
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 8,
    paddingBottom: 8,
    height: 64,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  tabBarLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  header: {
    backgroundColor: '#6366F1',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
});
