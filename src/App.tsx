import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { AuthProvider } from './context/AuthContext';
import { AppNavigator } from './navigation/AppNavigator';
import { ErrorBoundary } from './components/ErrorBoundary';

export default function App() {
  return (
    <ErrorBoundary>
      <NavigationContainer>
        <AuthProvider>
          <StatusBar style="auto" />
          <AppNavigator />
        </AuthProvider>
      </NavigationContainer>
    </ErrorBoundary>
  );
}
