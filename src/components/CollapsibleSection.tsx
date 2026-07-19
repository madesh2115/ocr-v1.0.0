import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING } from '../theme/designSystem';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  collapseThreshold?: number;
}

export function CollapsibleSection({
  title,
  children,
  defaultExpanded = false,
  collapseThreshold = 300,
}: CollapsibleSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const childText = typeof children === 'string' ? children : '';
  const shouldCollapse = childText.length > collapseThreshold && !defaultExpanded;

  return (
    <View style={styles.section}>
      <Pressable style={styles.header} onPress={() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded((prev) => !prev);
      }}>
        <Text style={styles.title}>{title}</Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={COLORS.textSecondary}
        />
      </Pressable>
      {(expanded || !shouldCollapse) && <View style={styles.content}>{children}</View>}
      {shouldCollapse && !expanded && (
        <Pressable onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setExpanded(true);
        }}>
          <Text style={styles.expandHint}>Tap to expand</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: SPACING.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  content: {
    marginTop: SPACING.sm,
  },
  expandHint: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '600',
    marginTop: SPACING.sm,
    textAlign: 'center',
  },
});
