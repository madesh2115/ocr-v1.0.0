/**
 * Design System - Centralized design tokens for consistent UI
 * Following full-stack-design skill principles
 */

// Primary brand color - Indigo
export const COLORS = {
  primary: '#6366F1',
  primaryLight: '#EEF2FF',
  primaryDark: '#4F46E5',

  // Semantic colors
  success: '#10B981',
  successLight: '#D1FAE5',
  successDark: '#059669',

  error: '#EF4444',
  errorLight: '#FEE2E2',
  errorDark: '#DC2626',

  warning: '#F59E0B',
  warningLight: '#FEF3C7',
  warningDark: '#D97706',

  // Neutral colors - Premium Modern Light Theme
  background: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',

  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textTertiary: '#94A3B8',
  textInverse: '#FFFFFF',

  // Border colors
  border: '#E2E8F0',
  borderLight: '#F1F5F9',
  borderFocus: '#6366F1',

  // Specific uses
  teal: '#0D9488',
  tealLight: '#CCFBF1',
  tealBorder: '#99F6E4',
} as const;

// Spacing scale (4px base)
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

// Border radius
export const RADIUS = {
  sm: 6,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

// Typography
export const TYPOGRAPHY = {
  h1: {
    fontSize: 32,
    fontWeight: '700' as const,
    lineHeight: 40,
    letterSpacing: -0.5,
  },
  h2: {
    fontSize: 24,
    fontWeight: '700' as const,
    lineHeight: 32,
  },
  h3: {
    fontSize: 20,
    fontWeight: '600' as const,
    lineHeight: 28,
  },
  h4: {
    fontSize: 18,
    fontWeight: '600' as const,
    lineHeight: 24,
  },
  body: {
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 24,
  },
  bodySmall: {
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 20,
  },
  caption: {
    fontSize: 12,
    fontWeight: '500' as const,
    lineHeight: 16,
  },
  button: {
    fontSize: 16,
    fontWeight: '600' as const,
    lineHeight: 24,
  },
} as const;

// Shadows
export const SHADOWS = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
} as const;

// Touch target sizes
export const TOUCH = {
  minHeight: 44,
  minWidth: 44,
  hitSlop: { top: 10, bottom: 10, left: 10, right: 10 },
} as const;

// Animation durations
export const ANIMATION = {
  fast: 150,
  normal: 250,
  slow: 400,
} as const;

// Common styles helper
export const commonStyles = {
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h4,
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  inputWrapper: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    minHeight: TOUCH.minHeight,
  },
  primaryButtonText: {
    ...TYPOGRAPHY.button,
    color: COLORS.textInverse,
  },
  secondaryButton: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: SPACING.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    minHeight: TOUCH.minHeight,
  },
  secondaryButtonText: {
    ...TYPOGRAPHY.button,
    color: COLORS.textPrimary,
  },
} as const;
