import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth';
import { registerForPushNotifications } from '../notifications';
import { colors, radii, spacing, type } from '../theme';

export default function Settings({ navigation }: any) {
  const { user, signOut } = useAuth();
  const [pushReady, setPushReady] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const t = await registerForPushNotifications();
      setPushReady(!!t);
    })();
  }, []);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.profile}>
        {user?.avatarUrl ? (
          <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{user?.name ?? user?.login}</Text>
          {user?.name ? <Text style={styles.login}>@{user.login}</Text> : null}
        </View>
      </View>

      <Text style={styles.sectionLabel}>Notifications</Text>
      <Pressable style={styles.row} onPress={() => navigation.navigate('Repos')}>
        <View style={styles.rowIcon}>
          <Ionicons name="git-branch-outline" size={18} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Connect a repository</Text>
          <Text style={styles.rowSub}>
            Pick a repo; the app installs the push secret and workflow file automatically.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
      </Pressable>

      <View style={[styles.infoCard, !pushReady && { borderColor: colors.warningBg }]}>
        <Text style={styles.infoLabel}>Push status</Text>
        {pushReady === null ? (
          <Text style={styles.infoValue}>Checking...</Text>
        ) : pushReady ? (
          <Text style={styles.infoValue}>Ready. This device can receive pushes from connected repos.</Text>
        ) : (
          <Text style={[styles.infoValue, { color: colors.warning }]}>
            Push token not available. On web or Expo Go this is expected; build with EAS for full push support.
          </Text>
        )}
      </View>

      <View style={{ flex: 1 }} />

      <Pressable style={styles.signOut} onPress={signOut}>
        <Ionicons name="log-out-outline" size={18} color={colors.danger} />
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg },

  profile: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  name: { ...type.h3, color: colors.text },
  login: { ...type.small, color: colors.textMuted },

  sectionLabel: {
    ...type.tiny,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
  },
  rowIcon: {
    width: 36, height: 36, borderRadius: radii.sm,
    backgroundColor: colors.accentBg,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { ...type.bodyStrong, color: colors.text },
  rowSub: { ...type.small, color: colors.textMuted, marginTop: 2, lineHeight: 18 },

  infoCard: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoLabel: { ...type.tiny, color: colors.textMuted, textTransform: 'uppercase' },
  infoValue: { ...type.small, color: colors.text, marginTop: 4, lineHeight: 18 },

  signOut: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  signOutText: { ...type.bodyStrong, color: colors.danger },
});
