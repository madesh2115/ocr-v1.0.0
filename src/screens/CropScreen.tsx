/**
 * CropScreen.tsx
 * =================
 * Full-screen crop review with polygon overlay.
 *
 * Flow:
 *  ScanScreen (camera/gallery pick)
 *    → CropScreen (corner review + adjustment)
 *        → ExtractingScreen (OCR processing)
 *            → ResultScreen
 *
 * Features
 * - Displays detected corners from /api/v1/documents/detect-crop
 * - Dark overlay outside selected polygon
 * - 4 draggable corner handles
 * - Rotate CW / Rotate CCW buttons
 * - Re-detect button (re-calls detection API)
 * - Reset / Use Full Image / Retake buttons
 * - Confidence badge
 * - Loading / error states
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Image, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Dimensions, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackScreenProps } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { Image as RNImage } from 'react-native';

import { CropOverlay } from '../components/CropOverlay';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import {
  FourCorners, ImageRect, NormalizedPoint,
  apiCornersToFourCorners,
  defaultCorners, rotateCornersCW, computeImageRect,
} from '../utils/imageCoordinates';
import { detectDocumentBoundary, rotateAndDetect } from '../services/documentApi';
import type { RootStackParamList } from '../types';
import type { DetectionResponse } from '../services/documentApi';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY } from '../theme/designSystem';

type Props = StackScreenProps<RootStackParamList, 'Crop'>;

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Default crop when user taps "Use Full Image"
const FULL_CROP: FourCorners = {
  topLeft:     { x: 0, y: 0 },
  topRight:    { x: 1, y: 0 },
  bottomRight: { x: 1, y: 1 },
  bottomLeft:  { x: 0, y: 1 },
};

export function CropScreen({ navigation, route }: Props) {
  const { imageUri } = route.params;

  const [imageLayout, setImageLayout] = useState({ width: 0, height: 0 });
  const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [detectedCorners, setDetectedCorners] = useState<FourCorners | null>(null);
  const [activeCorners, setActiveCorners] = useState<FourCorners>(FULL_CROP);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [confidence, setConfidence] = useState(0);
  const [detectionMethod, setDetectionMethod] = useState('');
  const [imageRotations, setImageRotations] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Compute image display rect for resizeMode="contain"
  const imgRect: ImageRect | null = (imageLayout.width > 0 && imageNaturalSize)
    ? computeImageRect(imageLayout.width, imageLayout.height, imageNaturalSize.width, imageNaturalSize.height)
    : null;

  // ─── Initial detection ────────────────────────────────────────────────
  useEffect(() => {
    if (!imageUri) return;
    runDetection(imageUri, 0);
  }, []);

  const runDetection = async (uri: string, rotations: number) => {
    setIsDetecting(true);
    setStatusMsg('Detecting bill boundary...');
    setError(null);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const result = await detectDocumentBoundary(uri, false, ctrl.signal);
      const corners = apiCornersToFourCorners(result.data!.corners);
      setDetectedCorners(corners);
      setActiveCorners(corners);
      setConfidence(result.data!.confidence);
      setDetectionMethod(result.data!.method);
      setImageRotations(rotations);
      setStatusMsg(
        result.data!.confidence >= 0.8
          ? 'Bill boundary detected. Adjust corners if needed.'
          : result.data!.confidence >= 0.6
          ? 'Boundary detected with low confidence. Please verify.'
          : 'Could not auto-detect boundary. Please adjust corners manually.',
      );
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      setError(e.message ?? 'Detection failed');
      setDetectedCorners(FULL_CROP);
      setActiveCorners(FULL_CROP);
      setStatusMsg('Using full image. Adjust corners manually.');
    } finally {
      setIsDetecting(false);
    }
  };

  // ─── Corners change ──────────────────────────────────────────────
  const handleCornersChange = useCallback((corners: FourCorners) => {
    setActiveCorners(corners);
  }, []);

  // ─── Rotation ──────────────────────────────────────────────────
  const handleRotateCW = async () => {
    // Rotate corners CW in normalized space
    const newRot = (imageRotations + 1) % 4;
    setActiveCorners(prev => rotateCornersCW(prev));
    setImageRotations(newRot);
    // Re-detect on rotated image for better accuracy
    await runDetection(imageUri, newRot);
  };

  const handleRotateCCW = async () => {
    // CCW = 3 CW rotations
    const newRot = (imageRotations + 3) % 4;
    setActiveCorners(prev => rotateCornersCW(rotateCornersCW(rotateCornersCW(prev))));
    setImageRotations(newRot);
    await runDetection(imageUri, newRot);
  };

  // ─── Reset to detected ──────────────────────────────────────────
  const handleReset = () => {
    if (detectedCorners) setActiveCorners(detectedCorners);
    else setActiveCorners(FULL_CROP);
  };

  // ─── Use full image ──────────────────────────────────────────────
  const handleUseFullImage = () => {
    setActiveCorners(FULL_CROP);
  };

  // ─── Re-detect ────────────────────────────────────────────────
  const handleReDetect = () => runDetection(imageUri, imageRotations);

  // ─── Confirm crop → Extracting ────────────────────────────────
  const handleConfirm = () => {
    if (isExtracting) return;
    setIsExtracting(true);
    navigation.navigate('Extracting', {
      imageUri,
      cropBox: activeCorners,   // full FourCorners, not rectangle
    });
  };

  // ─── Image load ──────────────────────────────────────────────
  const handleImageLoad = () => {
    RNImage.getSize(imageUri, (w, h) => {
      setImageNaturalSize({ width: w, height: h });
    }, () => {});
  };

  // ─── Confidence color ────────────────────────────────────────
  const confColor = confidence >= 0.8 ? COLORS.success : confidence >= 0.6 ? COLORS.warning : COLORS.error;
  const confLabel = confidence >= 0.8 ? 'High' : confidence >= 0.6 ? 'Medium' : 'Low';

  if (!imgRect || imageNaturalSize === null) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading image...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </Pressable>
        <Text style={styles.title}>Adjust Crop</Text>
        <View style={styles.confBadge}>
          {isDetecting ? (
            <ActivityIndicator size="small" color={COLORS.primary} />
          ) : (
            <>
              <View style={[styles.confDot, { backgroundColor: confColor }]} />
              <Text style={[styles.confText, { color: confColor }]}>
                {confidence > 0 ? `${confLabel} (${Math.round(confidence * 100)}%)` : 'Manual'}
              </Text>
            </>
          )}
        </View>
      </View>

      {/* Status message */}
      <View style={styles.statusBar}>
        <Text style={styles.statusText}>{statusMsg || 'Adjust the corners to match the bill edges.'}</Text>
      </View>

      {/* Image + overlay */}
      <View
        style={styles.previewContainer}
        onLayout={e => setImageLayout({
          width: e.nativeEvent.layout.width,
          height: e.nativeEvent.layout.height,
        })}
      >
        <RNImage
          source={{ uri: imageUri }}
          style={[styles.previewImage, {
            width: imgRect.width,
            height: imgRect.height,
          }]}
          resizeMode="contain"
          onLoad={handleImageLoad}
        />
        <CropOverlay
          corners={activeCorners}
          imgRect={imgRect}
          onCornersChange={handleCornersChange}
        />
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        <View style={styles.actionRow}>
          <SecondaryButton icon="refresh-outline" label="Re-detect" onPress={handleReDetect} disabled={isDetecting} />
          <SecondaryButton icon="expand-outline" label="Full Image" onPress={handleUseFullImage} disabled={isDetecting} />
          <SecondaryButton icon="crop-outline" label="Reset" onPress={handleReset} disabled={isDetecting} />
        </View>
        <View style={styles.actionRow}>
          <SecondaryButton icon="arrow-undo-outline" label="Rotate Left" onPress={handleRotateCCW} disabled={isDetecting} />
          <SecondaryButton icon="arrow-redo-outline" label="Rotate Right" onPress={handleRotateCW} disabled={isDetecting} />
        </View>
      </View>

      {/* Confirm */}
      <View style={styles.confirmRow}>
        <Pressable style={styles.retakeBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.retakeText}>Retake</Text>
        </Pressable>
        <PrimaryButton
          icon="checkmark-outline"
          label="Confirm Crop"
          onPress={handleConfirm}
          disabled={isDetecting || isExtracting}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: COLORS.background },
  loadingText: { color: COLORS.textTertiary, fontSize: 15 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '900' },
  confBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  confDot: { width: 8, height: 8, borderRadius: 4 },
  confText: { fontSize: 12, fontWeight: '700' },
  statusBar: { backgroundColor: COLORS.surface, paddingHorizontal: 16, paddingVertical: 10 },
  statusText: { color: COLORS.textSecondary, fontSize: 13 },
  previewContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    overflow: 'hidden',
  },
  previewImage: { position: 'absolute' },
  actions: { paddingHorizontal: 16, paddingVertical: 12, gap: 10, backgroundColor: COLORS.surface },
  actionRow: { flexDirection: 'row', gap: 10 },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 24,
    paddingTop: 8,
    backgroundColor: COLORS.surface,
  },
  retakeBtn: { flex: 1, paddingVertical: 16, alignItems: 'center', borderRadius: 12, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  retakeText: { color: COLORS.textSecondary, fontWeight: '800', fontSize: 15 },
});
