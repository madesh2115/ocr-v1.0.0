import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, authFetch } from '../../context/AuthContext';
import { useToast } from '../../hooks/useToast';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY, TOUCH } from '../../theme/designSystem';

type Props = { navigation: any };

type OrganizationSummary = {
  id: number;
  name: string;
  logo_url: string | null;
  role: 'owner' | 'admin' | 'member';
};

const TIER_COLORS: Record<string, { bg: string; text: string }> = {
  free: { bg: COLORS.borderLight, text: COLORS.textSecondary },
  pro: { bg: COLORS.warningLight, text: COLORS.warningDark },
  team: { bg: COLORS.primaryLight, text: COLORS.primaryDark },
};

export function ProfileScreen({ navigation }: Props) {
  const { user, isAuthenticated, logout, refreshToken, token } = useAuth();
  const showToast = useToast();
  const [showOrgPicker, setShowOrgPicker] = useState(false);
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (isAuthenticated) fetchOrganizations();
  }, [isAuthenticated]);

  const fetchOrganizations = async () => {
    setLoadingOrgs(true);
    try {
      const res = await authFetch('/organizations', { method: 'GET' }, refreshToken);
      if (res.ok) {
        const data = await res.json();
        setOrganizations(data.organizations ?? []);
      }
    } catch { /* silently fail */ } finally {
      setLoadingOrgs(false);
    }
  };

  const handleSwitchOrg = (orgId: number) => {
    setCurrentOrgId(orgId === 0 ? undefined : orgId);
    setShowOrgPicker(false);
    showToast('Organization switched', 'success');
  };

  const handleLogout = async () => { await logout(); };

  const getInitials = (name: string) => name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

  const tierColors = TIER_COLORS[user?.subscription_tier?.toLowerCase() ?? 'free'];

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      {/* Avatar + Identity */}
      <View style={styles.identityCard}>
        <View style={styles.avatarRing}>
          <View style={styles.avatarInitials}>
            <Text style={styles.avatarInitialsText}>{getInitials(user?.full_name ?? 'U')}</Text>
          </View>
        </View>
        <Text style={styles.userName}>{user?.full_name ?? 'User'}</Text>
        <Text style={styles.userEmail}>{user?.email ?? ''}</Text>
        <View style={[styles.tierBadge, { backgroundColor: tierColors.bg }]}>
          <Text style={[styles.tierText, { color: tierColors.text }]}>{user?.subscription_tier ?? 'Free'}</Text>
        </View>
      </View>

      {/* Organization Switcher */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Organization</Text>
        <Pressable style={styles.orgPickerRow} onPress={() => setShowOrgPicker(!showOrgPicker)}>
          <View style={styles.orgLeft}>
            <Ionicons name="business-outline" size={20} color={COLORS.primary} />
            <Text style={styles.orgName}>{organizations.find(o => o.id === currentOrgId)?.name ?? 'Personal'}</Text>
          </View>
          <Ionicons name={showOrgPicker ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
        </Pressable>

        {showOrgPicker && (
          <View style={styles.orgList}>
            <Pressable style={[styles.orgOption, !currentOrgId && styles.orgOptionActive]} onPress={() => handleSwitchOrg(0)}>
              <Ionicons name="person-outline" size={18} color={COLORS.primary} />
              <Text style={[styles.orgOptionText, !currentOrgId && styles.orgOptionTextActive]}>Personal</Text>
            </Pressable>
            {loadingOrgs ? (
              <ActivityIndicator color={COLORS.primary} style={{ padding: SPACING.md }} />
            ) : (
              organizations.map((org) => (
                <Pressable key={org.id} style={[styles.orgOption, currentOrgId === org.id && styles.orgOptionActive]} onPress={() => handleSwitchOrg(org.id)}>
                  <Ionicons name="business" size={18} color={COLORS.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.orgOptionText, currentOrgId === org.id && styles.orgOptionTextActive]}>{org.name}</Text>
                    <Text style={styles.orgRoleBadge}>{org.role}</Text>
                  </View>
                </Pressable>
              ))
            )}
          </View>
        )}
      </View>

      {/* Menu */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>

        <MenuItem icon="business-outline" label="My Organization" onPress={() => navigation.navigate('OrganizationSettings')} />
        <MenuItem icon="card-outline" label="Subscription" onPress={() => navigation.navigate('SubscriptionStatus')} badge={user?.subscription_tier !== 'Free' ? user?.subscription_tier : undefined} />
        <MenuItem icon="settings-outline" label="Settings" onPress={() => navigation.navigate('Settings')} />
        <MenuItem icon="help-circle-outline" label="Help & Support" onPress={() => showToast('Help & Support coming soon', 'info')} />
        <MenuItem icon="log-out-outline" label="Logout" onPress={handleLogout} danger />
      </View>
    </ScrollView>
  );
}

function MenuItem({ icon, label, onPress, danger = false, badge }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean; badge?: string }) {
  return (
    <Pressable style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]} onPress={onPress}>
      <Ionicons name={icon} size={20} color={danger ? COLORS.error : COLORS.primary} />
      <Text style={[styles.menuItemLabel, danger && styles.menuItemLabelDanger]}>{label}</Text>
      {badge && <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View>}
      {!danger && <Ionicons name="chevron-forward" size={16} color={COLORS.textTertiary} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: SPACING.md, paddingBottom: 100, backgroundColor: COLORS.background, gap: SPACING.md },
  identityCard: { alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.lg, gap: SPACING.xs, borderWidth: 1, borderColor: COLORS.border },
  avatarRing: { borderWidth: 3, borderColor: COLORS.primary, borderRadius: 50, padding: 2, marginBottom: SPACING.sm },
  avatarInitials: { width: 72, height: 72, borderRadius: 50, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  avatarInitialsText: { color: COLORS.textInverse, fontSize: 24, fontWeight: '900' },
  userName: { ...TYPOGRAPHY.h3, color: COLORS.textPrimary },
  userEmail: { ...TYPOGRAPHY.bodySmall, color: COLORS.textSecondary },
  tierBadge: { paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs, borderRadius: RADIUS.full, marginTop: SPACING.xs },
  tierText: { ...TYPOGRAPHY.caption, fontWeight: '800', textTransform: 'uppercase' },
  section: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  sectionTitle: { ...TYPOGRAPHY.caption, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8, paddingHorizontal: SPACING.md, paddingTop: SPACING.md, paddingBottom: SPACING.sm },
  orgPickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.borderLight },
  orgLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  orgName: { ...TYPOGRAPHY.body, fontWeight: '600', color: COLORS.textPrimary },
  orgList: { borderTopWidth: 1, borderTopColor: COLORS.borderLight },
  orgOption: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.borderLight },
  orgOptionActive: { backgroundColor: COLORS.primaryLight },
  orgOptionText: { ...TYPOGRAPHY.bodySmall, fontWeight: '600', color: COLORS.textPrimary },
  orgOptionTextActive: { color: COLORS.primary },
  orgRoleBadge: { ...TYPOGRAPHY.caption, color: COLORS.textSecondary, textTransform: 'capitalize', marginTop: 2 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.borderLight },
  menuItemPressed: { backgroundColor: COLORS.borderLight },
  menuItemLabel: { ...TYPOGRAPHY.body, color: COLORS.textPrimary, flex: 1 },
  menuItemLabelDanger: { color: COLORS.error },
  badge: { backgroundColor: COLORS.success, paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: RADIUS.full },
  badgeText: { ...TYPOGRAPHY.caption, color: COLORS.textInverse, fontWeight: '800', textTransform: 'uppercase' },
});
