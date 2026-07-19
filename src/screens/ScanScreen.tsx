/**
 * ScanScreen.tsx - Camera/gallery image selection
 */

import React, { useState } from 'react';
import {
  View, Text, Image, Pressable, StyleSheet,
  ActivityIndicator, Dimensions, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { PrimaryButton } from '../components/PrimaryButton';
import { SecondaryButton } from '../components/SecondaryButton';
import { PermissionDialog } from '../components/PermissionDialog';
import { NetworkStatusBadge } from '../components/NetworkStatusBadge';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useToast } from '../hooks/useToast';
import { getApiBaseUrl } from '../utils/apiConfig';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY, TOUCH } from '../theme/designSystem';

type Props = { navigation: any };

const IMAGE_PICKER_QUALITY = 0.72;
const API_BASE = getApiBaseUrl();

export function ScanScreen({ navigation }: Props) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [imageSource, setImageSource] = useState<'camera' | 'gallery' | null>(null);
  const [showPermissionDialog, setShowPermissionDialog] = useState(false);
  const [permissionType, setPermissionType] = useState<'camera' | 'gallery'>('camera');
  const [loading, setLoading] = useState(false);
  const { status: networkStatus } = useNetworkStatus();
  const showToast = useToast();

  const { width: screenWidth } = Dimensions.get('window');
  const previewHeight = screenWidth * 0.75;

  const openPermissionDialog = (type: 'camera' | 'gallery') => {
    setPermissionType(type);
    setShowPermissionDialog(true);
  };

  const handleScanPress = async () => {
    const { status } = await ImagePicker.getCameraPermissionsAsync();
    if (status === 'granted') {
      await scanImage();
    } else {
      openPermissionDialog('camera');
    }
  };

  const handleGalleryPress = async () => {
    const { status } = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (status === 'granted') {
      await pickImage();
    } else {
      openPermissionDialog('gallery');
    }
  };

  const handlePermissionConfirm = async () => {
    setShowPermissionDialog(false);
    if (permissionType === 'camera') await scanImage();
    else await pickImage();
  };

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { showToast('Please allow photo access in Settings', 'error'); return; }
    const pickerResult = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: IMAGE_PICKER_QUALITY });
    if (!pickerResult.canceled) {
      const asset = pickerResult.assets[0];
      setSelectedImage(asset.uri);
      setImageSize({ width: asset.width, height: asset.height });
      setImageSource('gallery');
    }
  };

  const scanImage = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { showToast('Please allow camera access in Settings', 'error'); return; }
    const cameraResult = await ImagePicker.launchCameraAsync({
      quality: IMAGE_PICKER_QUALITY,
      cameraType: ImagePicker.CameraType.back,
    });
    if (!cameraResult.canceled) {
      const asset = cameraResult.assets[0];
      setSelectedImage(asset.uri);
      setImageSize({ width: asset.width, height: asset.height });
      setImageSource('camera');
    }
  };

  const handleProceed = () => {
    if (!selectedImage) { showToast('Please scan or upload an image first', 'info'); return; }
    if (networkStatus === 'offline') { showToast('API is offline. Check your connection.', 'error'); return; }

    if (imageSource === 'gallery') {
      // Gallery upload - skip crop and go directly to extraction with auto-detected corners
      const defaultCropBox = {
        topLeft: { x: 0, y: 0 },
        topRight: { x: 1, y: 0 },
        bottomRight: { x: 1, y: 1 },
        bottomLeft: { x: 0, y: 1 },
      };
      navigation.navigate('Extracting', { imageUri: selectedImage, cropBox: defaultCropBox });
    } else {
      // Camera scan - go to crop screen for adjustment
      navigation.navigate('Crop', { imageUri: selectedImage });
    }
  };

  const handleRetake = () => { setSelectedImage(null); setImageSize(null); setImageSource(null); };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.screen} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image source={require('../../assets/icon.png')} style={styles.logoTiny} />
            <View>
              <Text style={styles.headerTitle}>Scan or Upload</Text>
              <Text style={styles.headerSubtitle}>
                {selectedImage
                  ? imageSource === 'gallery'
                    ? 'Image selected - will auto-extract data'
                    : 'Review and adjust the crop on the next screen'
                  : 'Take a photo or choose from gallery'}
              </Text>
            </View>
          </View>
          <NetworkStatusBadge status={networkStatus} />
        </View>

        {/* Preview area */}
        <View style={[styles.previewBox, { height: previewHeight }]}>
          {selectedImage ? (
            <Pressable style={styles.imagePressable} onPress={handleRetake}>
              <Image source={{ uri: selectedImage }} style={styles.previewImage} resizeMode="contain" />
              <View style={styles.retakeOverlay}>
                <Ionicons name="camera-reverse-outline" size={28} color={COLORS.textInverse} />
                <Text style={styles.retakeText}>Tap to retake</Text>
              </View>
            </Pressable>
          ) : (
            <View style={styles.emptyPreview}>
              <MaterialCommunityIcons name="file-document-outline" size={64} color={COLORS.textTertiary} />
              <Text style={styles.emptyText}>No image selected</Text>
              <Text style={styles.emptySubtext}>Capture or upload a bill to get started</Text>
            </View>
          )}
        </View>

        {/* Offline warning */}
        {networkStatus === 'offline' && (
          <View style={styles.offlineWarning}>
            <Ionicons name="cloud-offline-outline" size={16} color={COLORS.error} />
            <Text style={styles.offlineText}>API server is offline. Check your connection.</Text>
          </View>
        )}

        {/* Action buttons */}
        <View style={styles.actions}>
          {!selectedImage ? (
            <>
              <SecondaryButton icon="camera-outline" label="Scan with Camera" onPress={handleScanPress} style={styles.fullWidthBtn} />
              <SecondaryButton icon="images-outline" label="Choose from Gallery" onPress={handleGalleryPress} style={styles.fullWidthBtn} />
            </>
          ) : (
            <>
              <SecondaryButton icon="refresh-outline" label="Choose Different Image" onPress={handleRetake} />
              <PrimaryButton
                icon={imageSource === 'gallery' ? 'flash-outline' : 'crop-outline'}
                label={imageSource === 'gallery' ? 'Extract Data Automatically' : 'Review & Adjust Crop'}
                onPress={handleProceed}
                disabled={networkStatus === 'offline'}
              />
            </>
          )}
        </View>

        {/* Tip */}
        <View style={styles.tip}>
          <Ionicons name="bulb-outline" size={14} color={COLORS.textSecondary} />
          <Text style={styles.tipText}>
            {imageSource === 'gallery'
              ? 'Gallery images will be automatically processed. For camera scans, you can adjust corners before extraction.'
              : 'For best results: hold the camera steady, ensure good lighting, and keep the bill flat. You can adjust corners on the next screen.'}
          </Text>
        </View>

        <PermissionDialog visible={showPermissionDialog} type={permissionType} onConfirm={handlePermissionConfirm} onCancel={() => setShowPermissionDialog(false)} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scrollView: { flex: 1 },
  screen: { flexGrow: 1, padding: SPACING.md, gap: SPACING.md, paddingBottom: 100 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: SPACING.sm },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, flex: 1 },
  logoTiny: { width: 42, height: 42, borderRadius: RADIUS.sm },
  headerTitle: { ...TYPOGRAPHY.h3, color: COLORS.textPrimary },
  headerSubtitle: { ...TYPOGRAPHY.caption, color: COLORS.textSecondary, marginTop: 2 },
  previewBox: { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderRadius: RADIUS.lg, borderWidth: 1.5, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  previewImage: { flex: 1, width: '100%' },
  imagePressable: { flex: 1, width: '100%', position: 'relative' },
  retakeOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(15, 23, 42, 0.65)', paddingVertical: SPACING.sm, alignItems: 'center', gap: 4 },
  retakeText: { color: COLORS.textInverse, fontSize: 12, fontWeight: '600' },
  emptyPreview: { alignItems: 'center', gap: SPACING.sm },
  emptyText: { ...TYPOGRAPHY.body, fontWeight: '700', color: COLORS.textSecondary },
  emptySubtext: { ...TYPOGRAPHY.caption, color: COLORS.textTertiary },
  offlineWarning: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.errorLight, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderWidth: 1, borderColor: COLORS.error },
  offlineText: { ...TYPOGRAPHY.caption, fontWeight: '600', color: COLORS.error },
  actions: { gap: SPACING.sm },
  fullWidthBtn: { width: '100%' },
  tip: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm, paddingHorizontal: SPACING.xs },
  tipText: { flex: 1, ...TYPOGRAPHY.caption, color: COLORS.textSecondary, lineHeight: 18 },
});
