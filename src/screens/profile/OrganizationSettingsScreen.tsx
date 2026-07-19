import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  ActivityIndicator, TextInput, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../hooks/useToast';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { getApiBaseUrl } from '../../utils/apiConfig';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY } from '../../theme/designSystem';

const DEFAULT_API_BASE = getApiBaseUrl();

type Props = { navigation: any };

type OrgMember = {
  id: number;
  user_id: number;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  avatar_url?: string;
};

type OrgDetails = {
  id: number;
  name: string;
  logo_url: string | null;
  role: 'owner' | 'admin' | 'member';
};

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  owner: { bg: '#DBEAFE', text: COLORS.primaryDark },
  admin: { bg: COLORS.warningLight, text: COLORS.warningDark },
  member: { bg: COLORS.borderLight, text: COLORS.textSecondary },
};

export function OrganizationSettingsScreen({ navigation }: Props) {
  const { user, refreshToken } = useAuth();
  const showToast = useToast();
  const [org, setOrg] = useState<OrgDetails | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [inviting, setInviting] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);

  const isOwnerOrAdmin = org?.role === 'owner' || org?.role === 'admin';

  useEffect(() => {
    fetchOrgDetails().then(() => fetchMembers());
  }, []);

  const fetchOrgDetails = async () => {
    try {
      const res = await fetch(`${DEFAULT_API_BASE.replace(/\/$/, '')}/organizations/current`, {
        headers: { Authorization: `Bearer ` },
      });
      if (res.ok) {
        const data = await res.json();
        setOrg(data.organization ?? null);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  const fetchMembers = async () => {
    if (!org?.id) return;
    try {
      const res = await fetch(`${DEFAULT_API_BASE.replace(/\/$/, '')}/organizations/${org?.id}/members`, {
        headers: { Authorization: `Bearer ` },
      });
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members ?? []);
      }
    } catch {
      // silently fail
    }
  };

  const handleRemoveMember = (member: OrgMember) => {
    if (!org?.id) {
      showToast('Organization not loaded', 'error');
      return;
    }
    if (member.role === 'owner') {
      showToast('Cannot remove the owner', 'error');
      return;
    }
    Alert.alert(
      'Remove Member',
      `Remove ${member.name} from the organization?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemovingId(member.id);
            try {
              const res = await fetch(
                `${DEFAULT_API_BASE.replace(/\/$/, '')}/organizations/${org?.id}/members/${member.id}`,
                {
                  method: 'DELETE',
                  headers: { Authorization: `Bearer ` },
                }
              );
              if (res.ok) {
                setMembers((prev) => prev.filter((m) => m.id !== member.id));
                showToast('Member removed', 'success');
              } else {
                showToast('Failed to remove member', 'error');
              }
            } catch {
              showToast('Network error', 'error');
            } finally {
              setRemovingId(null);
            }
          },
        },
      ]
    );
  };

  const handleInvite = async () => {
    if (!org?.id) {
      showToast('Organization not loaded', 'error');
      return;
    }
    if (!inviteEmail.trim()) {
      showToast('Please enter an email address', 'error');
      return;
    }
    setInviting(true);
    try {
      const res = await fetch(`${DEFAULT_API_BASE.replace(/\/$/, '')}/organizations/${org?.id}/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer `,
        },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      if (res.ok) {
        showToast('Invitation sent', 'success');
        setInviteEmail('');
        fetchMembers();
      } else {
        const err = await res.json().catch(() => ({ message: 'Failed to send invitation' }));
        showToast(err.message ?? 'Failed to send invitation', 'error');
      }
    } catch {
      showToast('Network error', 'error');
    } finally {
      setInviting(false);
    }
  };

  const handleLeaveOrg = () => {
    if (!org?.id) {
      showToast('Organization not loaded', 'error');
      return;
    }
    Alert.alert(
      'Leave Organization',
      'Are you sure you want to leave this organization?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await fetch(`${DEFAULT_API_BASE.replace(/\/$/, '')}/organizations/${org?.id}/leave`, {
                method: 'POST',
                headers: { Authorization: `Bearer ` },
              });
              if (res.ok) {
                showToast('You have left the organization', 'success');
                navigation.goBack();
              } else {
                showToast('Failed to leave organization', 'error');
              }
            } catch {
              showToast('Network error', 'error');
            }
          },
        },
      ]
    );
  };

  const getInitials = (name: string) =>
    name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>My Organization</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.screen}>
      {/* Org info */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Organization</Text>
        <View style={styles.orgHeader}>
          <View style={styles.orgAvatar}>
            <Text style={styles.orgAvatarText}>{getInitials(org?.name ?? 'O')}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.orgName}>{org?.name ?? 'My Organization'}</Text>
            <Text style={styles.orgRoleLabel}>You are: {org?.role}</Text>
          </View>
        </View>
      </View>

      {/* Member list */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Members ({members.length})</Text>
        {members.map((member) => {
          const roleColors = ROLE_COLORS[member.role] ?? ROLE_COLORS.member;
          return (
            <View key={member.id} style={styles.memberRow}>
              <View style={styles.memberAvatar}>
                <Text style={styles.memberAvatarText}>{getInitials(member.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.memberName}>{member.name}</Text>
                <Text style={styles.memberEmail}>{member.email}</Text>
              </View>
              <View style={[styles.roleBadge, { backgroundColor: roleColors.bg }]}>
                <Text style={[styles.roleBadgeText, { color: roleColors.text }]}>{member.role}</Text>
              </View>
              {isOwnerOrAdmin && member.role !== 'owner' && (
                <Pressable
                  style={styles.removeBtn}
                  onPress={() => handleRemoveMember(member)}
                  disabled={removingId === member.id}
                >
                  {removingId === member.id ? (
                    <ActivityIndicator color={COLORS.error} size="small" />
                  ) : (
                    <Ionicons name="close-circle" size={22} color={COLORS.error} />
                  )}
                </Pressable>
              )}
            </View>
          );
        })}
      </View>

      {/* Invite section */}
      {isOwnerOrAdmin && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Invite New Member</Text>
          <TextInput
            style={styles.textInput}
            placeholder="Email address"
            placeholderTextColor={COLORS.textTertiary}
            value={inviteEmail}
            onChangeText={setInviteEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <View style={styles.roleSelector}>
            <Text style={styles.roleSelectorLabel}>Role:</Text>
            {(['admin', 'member'] as const).map((r) => (
              <Pressable
                key={r}
                style={[styles.roleOption, inviteRole === r && styles.roleOptionActive]}
                onPress={() => setInviteRole(r)}
              >
                <Text style={[styles.roleOptionText, inviteRole === r && styles.roleOptionTextActive]}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>
          <SecondaryButton
            icon="mail-outline"
            label={inviting ? 'Sending...' : 'Send Invitation'}
            onPress={handleInvite}
            disabled={inviting}
            loading={inviting}
          />
        </View>
      )}

      {/* Leave org (non-owner members) */}
      {!isOwnerOrAdmin && (
        <Pressable style={styles.leaveBtn} onPress={handleLeaveOrg}>
          <Ionicons name="exit-outline" size={20} color={COLORS.error} />
          <Text style={styles.leaveBtnText}>Leave Organization</Text>
        </Pressable>
      )}
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  screen: {
    flexGrow: 1,
    padding: 18,
    paddingBottom: 100,
    backgroundColor: COLORS.background,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    gap: 14,
  },
  cardTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '900',
  },
  orgHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  orgAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orgAvatarText: {
    color: COLORS.textInverse,
    fontSize: 18,
    fontWeight: '900',
  },
  orgName: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  orgRoleLabel: {
    color: COLORS.textSecondary,
    fontSize: 13,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
  },
  memberAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: '900',
  },
  memberName: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  memberEmail: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 1,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  removeBtn: {
    padding: 4,
  },
  textInput: {
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  roleSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  roleSelectorLabel: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  roleOption: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: COLORS.borderLight,
  },
  roleOptionActive: {
    backgroundColor: COLORS.primary,
  },
  roleOptionText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  roleOptionTextActive: {
    color: COLORS.textInverse,
  },
  leaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.errorLight,
    borderRadius: 12,
    paddingVertical: 14,
  },
  leaveBtnText: {
    color: COLORS.error,
    fontSize: 15,
    fontWeight: '800',
  },
});
