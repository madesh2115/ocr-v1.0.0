import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING } from '../theme/designSystem';

export type ExtractionStep = 'uploading' | 'ocr' | 'parsing' | 'saving';

interface Step {
  key: ExtractionStep;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const STEPS: Step[] = [
  { key: 'uploading', label: 'Uploading', icon: 'cloud-upload-outline' },
  { key: 'ocr', label: 'Running OCR', icon: 'scan-outline' },
  { key: 'parsing', label: 'Parsing text', icon: 'document-text-outline' },
  { key: 'saving', label: 'Saving', icon: 'server-outline' },
];

interface ProgressStepsProps {
  activeStep: ExtractionStep;
  completedSteps: ExtractionStep[];
}

export function ProgressSteps({ activeStep, completedSteps }: ProgressStepsProps) {
  const activeIndex = STEPS.findIndex((s) => s.key === activeStep);

  return (
    <View style={styles.container}>
      {STEPS.map((step, index) => {
        const isCompleted = completedSteps.includes(step.key);
        const isActive = step.key === activeStep;
        const isLast = index === STEPS.length - 1;

        return (
          <React.Fragment key={step.key}>
            <View style={styles.stepItem}>
              <View
                style={[
                  styles.circle,
                  isCompleted && styles.circleCompleted,
                  isActive && styles.circleActive,
                ]}
              >
                {isCompleted ? (
                  <Ionicons name="checkmark" size={16} color={COLORS.textInverse} />
                ) : (
                  <Ionicons
                    name={step.icon}
                    size={16}
                    color={isActive ? COLORS.textInverse : COLORS.textTertiary}
                  />
                )}
              </View>
              <Text
                style={[
                  styles.label,
                  isActive && styles.labelActive,
                  isCompleted && styles.labelCompleted,
                ]}
                numberOfLines={1}
              >
                {step.label}
              </Text>
            </View>
            {!isLast && (
              <View
                style={[styles.connector, isCompleted && styles.connectorCompleted]}
              />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  stepItem: {
    alignItems: 'center',
    width: 64,
  },
  circle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  circleActive: {
    backgroundColor: COLORS.primary,
  },
  circleCompleted: {
    backgroundColor: COLORS.success,
  },
  label: {
    fontSize: 11,
    color: COLORS.textTertiary,
    fontWeight: '600',
    textAlign: 'center',
  },
  labelActive: {
    color: COLORS.primary,
    fontWeight: '800',
  },
  labelCompleted: {
    color: COLORS.success,
  },
  connector: {
    height: 2,
    flex: 1,
    backgroundColor: COLORS.border,
    marginBottom: 22,
    marginHorizontal: 4,
  },
  connectorCompleted: {
    backgroundColor: COLORS.success,
  },
});
