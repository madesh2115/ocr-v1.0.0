import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY, TOUCH } from '../../theme/designSystem';

type Props = { navigation: any };

export function ForgotPasswordScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleSendResetEmail = async () => {
    if (!email.trim()) {
      Alert.alert('Error', 'Please enter your email address');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    setIsLoading(true);
    try {
      // Stub: Replace with actual API call
      await new Promise(resolve => setTimeout(resolve, 1500));
      setEmailSent(true);
    } catch (error) {
      setEmailSent(true); // Show success anyway to prevent email enumeration
    } finally {
      setIsLoading(false);
    }
  };

  if (emailSent) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.successContainer}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={64} color={COLORS.success} />
          </View>
          <Text style={styles.successTitle}>Check Your Email</Text>
          <Text style={styles.successText}>
            We've sent a password reset link to{'n'}<Text style={styles.successEmail}>{email}</Text>
          </Text>
          <Text style={styles.successHint}>
            If you don't see the email, check your spam folder or try again.
          </Text>
          <TouchableOpacity style={styles.successBackButton} onPress={() => navigation.goBack()}>
            <Text style={styles.backButtonText}>Back to Sign In</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Back Button */}
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} hitSlop={TOUCH.hitSlop}>
            <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
          </TouchableOpacity>

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <Ionicons name="key-outline" size={40} color={COLORS.primary} />
            </View>
            <Text style={styles.title}>Forgot Password?</Text>
            <Text style={styles.subtitle}>
              Enter your email address and we'll send you a link to reset your password.
            </Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Email</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="mail-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Enter your email"
                  placeholderTextColor={COLORS.textTertiary}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
                />
              </View>
            </View>

            <TouchableOpacity
              style={[styles.sendButton, isLoading && styles.sendButtonDisabled]}
              onPress={handleSendResetEmail}
              disabled={isLoading}
              activeOpacity={0.8}
            >
              {isLoading ? (
                <ActivityIndicator color={COLORS.textInverse} />
              ) : (
                <Text style={styles.sendButtonText}>Send Reset Link</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Back to Login */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Remember your password? </Text>
            <TouchableOpacity onPress={() => navigation.goBack()} disabled={isLoading}>
              <Text style={styles.footerLink}>Sign In</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1, padding: SPACING.lg },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.lg },
  header: { alignItems: 'center', marginBottom: SPACING.xl },
  iconContainer: { width: 80, height: 80, borderRadius: RADIUS.xl, backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.lg },
  title: { ...TYPOGRAPHY.h1, color: COLORS.textPrimary, marginBottom: SPACING.sm, textAlign: 'center' },
  subtitle: { ...TYPOGRAPHY.body, color: COLORS.textSecondary, textAlign: 'center', paddingHorizontal: SPACING.md, lineHeight: 24 },
  form: { width: '100%' },
  inputContainer: { marginBottom: SPACING.lg },
  label: { ...TYPOGRAPHY.bodySmall, fontWeight: '600', color: COLORS.textPrimary, marginBottom: SPACING.xs },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  inputIcon: { marginLeft: SPACING.md },
  input: { flex: 1, paddingVertical: SPACING.md, paddingHorizontal: SPACING.sm, ...TYPOGRAPHY.body, color: COLORS.textPrimary },
  sendButton: { backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: SPACING.md, alignItems: 'center', minHeight: TOUCH.minHeight },
  sendButtonDisabled: { opacity: 0.7 },
  sendButtonText: { ...TYPOGRAPHY.button, color: COLORS.textInverse },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: SPACING.xl },
  footerText: { ...TYPOGRAPHY.body, color: COLORS.textSecondary },
  footerLink: { ...TYPOGRAPHY.body, color: COLORS.primary, fontWeight: '600' },
  // Success state
  successContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg },
  successIcon: { width: 120, height: 120, borderRadius: 60, backgroundColor: COLORS.successLight, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.xl },
  successTitle: { ...TYPOGRAPHY.h1, color: COLORS.textPrimary, marginBottom: SPACING.md },
  successText: { ...TYPOGRAPHY.body, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 24 },
  successEmail: { fontWeight: '600', color: COLORS.textPrimary },
  successHint: { ...TYPOGRAPHY.bodySmall, color: COLORS.textTertiary, textAlign: 'center', marginTop: SPACING.sm },
  successBackButton: { marginTop: SPACING.xl, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  backButtonText: { ...TYPOGRAPHY.body, fontWeight: '600', color: COLORS.textPrimary },
});
