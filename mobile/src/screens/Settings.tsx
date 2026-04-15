import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Image, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth';
import { registerForPushNotifications } from '../notifications';
import { colors, radii, spacing, type } from '../theme';

export default function Settings() {
  const { user, signOut } = useAuth();
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    (async () => {
      setRegistering(true);
      try {
        const t = await registerForPushNotifications();
        setPushToken(t);
      } finally {
        setRegistering(false);
      }
    })();
  }, []);

  const copyToken = async () => {
    if (!pushToken) return;
    await Clipboard.setStringAsync(pushToken);
    Alert.alert('Copied', 'Push token copied to clipboard. Paste it into your GitHub repo secret (EXPO_PUSH_TOKEN).');
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
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Expo push token</Text>
        {registering ? (
          <Text style={styles.tokenPlaceholder}>Requesting permission...</Text>
        ) : pushToken ? (
          <>
            <Text style={styles.token} numberOfLines={2} selectable>{pushToken}</Text>
            <Pressable style={styles.copyBtn} onPress={copyToken}>
              <Ionicons name="copy-outline" size={14} color={colors.accent} />
              <Text style={styles.copyBtnText}>Copy</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.tokenPlaceholder}>
            Push not available. Build with EAS and grant permission to receive notifications.
          </Text>
        )}
        <Text style={styles.hint}>
          Paste this into a GitHub Actions secret named EXPO_PUSH_TOKEN so workflows can send you notifications.
        </Text>
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

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardLabel: { ...type.small, color: colors.textMuted },
  token: { fontFamily: 'Menlo', fontSize: 12, color: colors.text },
  tokenPlaceholder: { ...type.small, color: colors.textMuted, fontStyle: 'italic' },
  copyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start',
    paddingVertical: 4, paddingHorizontal: 8,
    borderRadius: radii.sm, backgroundColor: colors.accentBg,
  },
  copyBtnText: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  hint: { ...type.small, color: colors.textMuted, lineHeight: 18 },

  signOut: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  signOutText: { ...type.bodyStrong, color: colors.danger },
});
