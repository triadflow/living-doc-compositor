import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth';
import {
  PushRuntime,
  pushRuntime,
  pushRuntimeLabel,
  registerForPushNotifications,
  sendPreviewNotification,
} from '../notifications';
import { colors, radii, spacing, type } from '../theme';

export default function Settings({ navigation }: any) {
  const { user, signOut } = useAuth();
  const runtime = pushRuntime();
  const [pushReady, setPushReady] = useState<boolean | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const isWeb = runtime === 'web';

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

  const triggerPreview = async () => {
    setPreviewing(true);
    try {
      const result = await sendPreviewNotification();
      setPreviewMessage(
        result.mode === 'local-notification'
          ? result.usesDoc
            ? `Preview sent. Opening it should route back into ${result.title}.`
            : 'Preview sent. It will land in Inbox because no doc is registered on this device yet.'
          : result.usesDoc
            ? `Preview written locally. Open Inbox to jump back into ${result.title}.`
            : 'Preview written locally to Inbox. Register or receive a doc first to test deep-link opening.'
      );
    } catch (err: any) {
      setPreviewMessage(`Preview failed: ${err?.message ?? 'Unknown error'}`);
    } finally {
      setPreviewing(false);
    }
  };

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
      <Pressable
        style={[styles.row, isWeb && styles.rowDisabled]}
        onPress={() => {
          if (isWeb) {
            Alert.alert(
              'Native only',
              'Browser preview does not support GitHub login or repo connection yet. Use a native build.'
            );
            return;
          }
          navigation.navigate('Repos');
        }}
      >
        <View style={styles.rowIcon}>
          <Ionicons name="git-branch-outline" size={18} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Connect a repository</Text>
          <Text style={styles.rowSub}>
            {isWeb
              ? 'Browser preview cannot connect repos yet. Use a native build.'
              : 'Pick a repo; the app installs the push secret and workflow file automatically.'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
      </Pressable>

      {!isReady ? (
        <Pressable style={styles.row} onPress={triggerPreview} disabled={previewing}>
          <View style={styles.rowIcon}>
            <Ionicons name="notifications-outline" size={18} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Trigger preview notification</Text>
            <Text style={styles.rowSub}>
              {previewMessage
                ?? 'Mimic notification delivery locally. If this device already knows a doc, the preview will point back to it; otherwise it lands in Inbox only.'}
            </Text>
          </View>
          {previewing ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Ionicons name="sparkles-outline" size={18} color={colors.textSubtle} />
          )}
        </Pressable>
      ) : null}

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
      return 'Expo Go cannot hold a real push token. Use the preview-notification action below for local testing, or install an EAS dev build for real pushes.';
    case 'web':
      return 'Browser previews cannot receive system pushes. Use the preview-notification action below for local Inbox testing, or install an EAS dev build to activate real delivery.';
    case 'eas':
      return 'Push token unavailable. Use the preview-notification action below for local testing, or confirm notification permission, EAS project setup, and rebuild the native app if needed.';
    default:
      return 'Push runtime could not be detected. Use the preview-notification action below for local testing, or install an EAS dev build to activate real delivery.';
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
  rowDisabled: { opacity: 0.65 },
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
