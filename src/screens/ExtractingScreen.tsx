import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, Image, StyleSheet, Animated,
  Dimensions, ScrollView, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { SecondaryButton } from '../components/SecondaryButton';
import { triggerHaptic } from '../hooks/useHaptics';
import { extractWithCorners } from '../services/documentApi';
import { getApiBaseUrl } from '../utils/apiConfig';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY } from '../theme/designSystem';

type Props = { navigation: any; route: any };

const API_BASE = getApiBaseUrl();

type Step = {
  key: string;
  label: string;
  icon: string;
};

const STEPS: Step[] = [
  { key: 'uploading', label: 'Uploading image...', icon: 'cloud-upload-outline' },
  { key: 'ocr',      label: 'Running OCR engine...', icon: 'scan-outline' },
  { key: 'parsing',  label: 'Parsing bill data...', icon: 'document-text-outline' },
  { key: 'saving',   label: 'Saving to database...', icon: 'save-outline' },
];

export function ExtractingScreen({ navigation, route }: Props) {
  const { imageUri, cropBox } = route.params;
  const abortControllerRef = useRef<AbortController | null>(null);

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Pulse animation for active step icon
  const pulseAnim = useRef(new Animated.Value(1)).current;
  // Scan line animation on image thumb
  const scanAnim = useRef(new Animated.Value(0)).current;

  // Timer to show elapsed seconds
  useEffect(() => {
    const timer = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Pulsing animation for active icon
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.25, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [currentStepIndex]);

  // Scan line on image
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(scanAnim, { toValue: 1, duration: 1600, useNativeDriver: true }),
        Animated.timing(scanAnim, { toValue: 0, duration: 1600, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  // Run extraction immediately on mount
  useEffect(() => {
    runExtraction();
    return () => abortControllerRef.current?.abort();
  }, []);

  const runExtraction = async () => {
    triggerHaptic('medium');
    setError(null);
    setCurrentStepIndex(0); // uploading

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // Get original image dimensions for coordinate validation
      const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        Image.getSize(
          imageUri,
          (w, h) => resolve({ width: w, height: h }),
          (e) => reject(e),
        );
      });

      setCurrentStepIndex(1); // ocr + perspective correction
      const payload = await extractWithCorners(
        imageUri,
        cropBox as any,  // FourCorners from CropScreen
        dims.width,
        dims.height,
        controller.signal,
      );

      setCurrentStepIndex(2); // parsing
      triggerHaptic('success');

      // Brief pause so user sees the "parsing" step, then navigate
      await new Promise(resolve => setTimeout(resolve, 400));
      navigation.replace('Result', { result: payload as any, imageUri });

    } catch (err: any) {
      if (err.name === 'AbortError') return;
      triggerHaptic('warning');
      const msg = err.message?.toLowerCase().includes('network') || err.message?.toLowerCase().includes('fetch')
        ? 'Cannot reach API. Make sure your phone and computer are on the same Wi-Fi network.'
        : err.message || 'Extraction failed. Please try again.';
      setError(msg);
    }
  };

  const handleCancel = () => {
    abortControllerRef.current?.abort();
    navigation.goBack();
  };

  const handleRetry = () => {
    setError(null);
    setElapsedSeconds(0);
    runExtraction();
  };

  const { width: screenWidth } = Dimensions.get('window');
  const thumbWidth = Math.min(screenWidth * 0.55, 260);
  const thumbHeight = thumbWidth * 1.35;

  const scanTranslateY = scanAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-thumbHeight / 2, thumbHeight / 2],
  });
  const scanOpacity = scanAnim.interpolate({
    inputRange: [0, 0.3, 0.7, 1],
    outputRange: [0, 0.9, 0.9, 0],
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <ScrollView
        contentContainerStyle={styles.screen}
        scrollEnabled={true}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.headerBar}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </Pressable>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle}>Extracting Data</Text>
            <Text style={styles.headerSub}>Please keep the app open</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Bill image thumbnail with scan line */}
        <View style={[styles.thumbWrap, { width: thumbWidth, height: thumbHeight }]}>
          <Image source={{ uri: imageUri }} style={styles.thumbImage} resizeMode="cover" />
          <View style={styles.thumbOverlay} />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.scanLine,
              { opacity: scanOpacity, transform: [{ translateY: scanTranslateY }] },
            ]}
          />
          {/* Corner brackets */}
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>

        {/* Steps */}
        <View style={styles.stepsContainer}>
          {STEPS.map((step, index) => {
            const isDone = index < currentStepIndex;
            const isActive = index === currentStepIndex && !error;
            const isPending = index > currentStepIndex;
            return (
              <View key={step.key} style={styles.stepRow}>
                <View style={[
                  styles.stepIconWrap,
                  isDone && styles.stepIconDone,
                  isActive && styles.stepIconActive,
                  isPending && styles.stepIconPending,
                ]}>
                  {isDone ? (
                    <Ionicons name="checkmark" size={18} color="#fff" />
                  ) : isActive ? (
                    <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                      <Ionicons name={step.icon as any} size={18} color="#fff" />
                    </Animated.View>
                  ) : (
                    <Ionicons name={step.icon as any} size={18} color={COLORS.textTertiary} />
                  )}
                </View>
                <View style={styles.stepContent}>
                  <Text style={[
                    styles.stepLabel,
                    isDone && styles.stepLabelDone,
                    isActive && styles.stepLabelActive,
                    isPending && styles.stepLabelPending,
                  ]}>
                    {step.label}
                  </Text>
                  {isActive && !error && (
                    <Text style={styles.stepSub}>{elapsedSeconds}s elapsed</Text>
                  )}
                </View>
                {index < STEPS.length - 1 && (
                  <View style={[styles.connector, isDone && styles.connectorDone]} />
                )}
              </View>
            );
          })}
        </View>

        {/* Error State */}
        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={22} color={COLORS.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : (
          <View style={styles.hintBox}>
            <Ionicons name="information-circle-outline" size={16} color={COLORS.textSecondary} />
            <Text style={styles.hintText}>
              OCR may take 5–15 seconds on the first scan. Subsequent scans are faster.
            </Text>
          </View>
        )}

        {/* Action Buttons */}
        <View style={styles.actions}>
          {error && (
            <SecondaryButton
              icon="refresh"
              label="Try Again"
              onPress={runExtraction}
            />
          )}
          <SecondaryButton
            icon="close"
            label="Cancel"
            onPress={handleCancel}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
    gap: 28,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitleContainer: { flex: 1, alignItems: 'center' },
  headerTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: COLORS.textPrimary,
    letterSpacing: 0.3,
  },
  headerSub: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  thumbWrap: {
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 2,
    borderColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(30, 41, 59, 0.25)',
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.primaryLight,
    shadowOpacity: 0.9,
    shadowRadius: 12,
    elevation: 5,
    top: '50%',
  },
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: COLORS.primary,
  },
  cornerTL: { top: 8, left: 8, borderTopWidth: 3, borderLeftWidth: 3 },
  cornerTR: { top: 8, right: 8, borderTopWidth: 3, borderRightWidth: 3 },
  cornerBL: { bottom: 8, left: 8, borderBottomWidth: 3, borderLeftWidth: 3 },
  cornerBR: { bottom: 8, right: 8, borderBottomWidth: 3, borderRightWidth: 3 },
  stepsContainer: {
    width: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 18,
    gap: 6,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingVertical: 6,
    position: 'relative',
  },
  stepIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepIconDone: { backgroundColor: COLORS.success },
  stepIconActive: { backgroundColor: COLORS.primary },
  stepIconPending: { backgroundColor: COLORS.border },
  stepContent: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 36,
  },
  stepLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  stepLabelDone: { color: COLORS.textTertiary },
  stepLabelActive: { color: COLORS.textPrimary },
  stepLabelPending: { color: COLORS.textSecondary },
  stepSub: {
    fontSize: 12,
    color: COLORS.primary,
    marginTop: 2,
  },
  connector: {
    position: 'absolute',
    left: 17,
    top: 42,
    width: 2,
    height: 18,
    backgroundColor: COLORS.border,
    borderRadius: 1,
  },
  connectorDone: { backgroundColor: COLORS.success },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: COLORS.errorLight,
    borderColor: COLORS.error,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    width: '100%',
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.errorDark,
    lineHeight: 20,
  },
  hintBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 4,
    width: '100%',
  },
  hintText: {
    flex: 1,
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  actions: {
    width: '100%',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
  },
});
