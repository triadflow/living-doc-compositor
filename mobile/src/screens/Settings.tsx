import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth';
import {
  PushRuntime,
  pushRuntime,
  pushRuntimeLabel,
  registerForPushNotifications,
} from '../notifications';
import { colors, radii, spacing, type } from '../theme';

export default function Settings({ navigation }: any) {
  const { user, signOut } = useAuth();
  const runtime = pushRuntime();
  const [pushReady, setPushReady] = useState<boolean | null>(null);

  useEffect(() => {
    if (runtime !== 'eas') {
      setPushReady(false);
      return;
    }
    let mounted = true;
    setPushReady(null);
    (async () => {
      const t = await registerForPushNotifications();
      if (mounted) setPushReady(!!t);
    })();
    return () => {
      mounted = false;
    };
  }, [runtime]);

  const isReady = runtime === 'eas' && pushReady === true;
  const isChecking = runtime === 'eas' && pushReady === null;

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

      <View style={[styles.infoCard, isReady ? styles.infoCardSuccess : styles.infoCardWarning]}>
        <Text style={styles.infoLabel}>Push status · {pushRuntimeLabel(runtime)}</Text>
        {isChecking ? (
          <Text style={styles.infoValue}>Checking...</Text>
        ) : isReady ? (
          <Text style={styles.infoValue}>Ready. This device can receive pushes from connected repos.</Text>
        ) : (
          <Text style={[styles.infoValue, { color: colors.warning }]}>
            {pushStatusMessage(runtime)}
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

function pushStatusMessage(runtime: PushRuntime): string {
  switch (runtime) {
    case 'expo-go':
      return 'Expo Go cannot hold a push token. Install an EAS dev build to receive real pushes.';
    case 'web':
      return 'Browser previews cannot receive pushes. Install an EAS dev build to activate.';
    case 'eas':
      return 'Notifications permission denied. Enable in system settings.';
    default:
      return 'Push runtime could not be detected. Install an EAS dev build to activate.';
  }
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
    letterSpacing: 0.8,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: 14,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
  },
  rowIcon: {
    width: 36, height: 36, borderRadius: radii.sm,
    backgroundColor: colors.accentBg,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { ...type.bodyStrong, color: colors.text },
  rowSub: { ...type.small, fontSize: 12.5, color: colors.textMuted, marginTop: 2, lineHeight: 17.5 },

  infoCard: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoCardSuccess: { borderColor: colors.successBg },
  infoCardWarning: { borderColor: colors.warningBg },
  infoLabel: { ...type.tiny, fontSize: 10, color: colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' },
  infoValue: { ...type.small, color: colors.text, marginTop: 4, lineHeight: 18 },

  signOut: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  signOutText: { ...type.bodyStrong, color: colors.danger },
});
