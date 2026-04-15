import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, Alert, Linking,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth';
import { colors, radii, spacing, type } from '../theme';

type Phase =
  | { name: 'idle' }
  | { name: 'requesting' }
  | { name: 'waiting'; userCode: string; verificationUri: string; deviceCode: string; interval: number }
  | { name: 'polling' };

export default function SignIn() {
  const { signIn, completeSignIn } = useAuth();
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });

  const start = async () => {
    setPhase({ name: 'requesting' });
    try {
      const code = await signIn();
      if (!code) throw new Error('No code returned');
      setPhase({
        name: 'waiting',
        userCode: code.userCode,
        verificationUri: code.verificationUri,
        deviceCode: code.deviceCode,
        interval: code.interval,
      });
    } catch (err: any) {
      Alert.alert('Sign-in failed', err.message ?? 'Unknown error');
      setPhase({ name: 'idle' });
    }
  };

  const authorize = async () => {
    if (phase.name !== 'waiting') return;
    await Clipboard.setStringAsync(phase.userCode);
    await Linking.openURL(phase.verificationUri);
    setPhase({ name: 'polling' });
    try {
      await completeSignIn(phase.deviceCode, phase.interval);
    } catch (err: any) {
      Alert.alert('Sign-in failed', err.message ?? 'Unknown error');
      setPhase({ name: 'idle' });
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.brand}>
          <Text style={styles.logo}>L</Text>
        </View>
        <Text style={styles.title}>Living Docs</Text>
        <Text style={styles.subtitle}>
          Sign in with GitHub to open your living docs and receive notifications when they change.
        </Text>

        {phase.name === 'waiting' ? (
          <View style={styles.codeBlock}>
            <Text style={styles.codeLabel}>Your code</Text>
            <Text style={styles.code}>{phase.userCode}</Text>
            <Text style={styles.codeHint}>
              We copied it to your clipboard. Tap "Authorize on GitHub" to finish.
            </Text>
          </View>
        ) : null}

        {phase.name === 'polling' ? (
          <View style={styles.polling}>
            <ActivityIndicator />
            <Text style={styles.pollingText}>Waiting for GitHub authorization</Text>
          </View>
        ) : null}

        {phase.name === 'idle' || phase.name === 'requesting' ? (
          <Pressable
            style={[styles.primaryBtn, phase.name === 'requesting' && { opacity: 0.6 }]}
            onPress={start}
            disabled={phase.name === 'requesting'}
          >
            <Ionicons name="logo-github" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>Sign in with GitHub</Text>
          </Pressable>
        ) : null}

        {phase.name === 'waiting' ? (
          <Pressable style={styles.primaryBtn} onPress={authorize}>
            <Ionicons name="open-outline" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>Authorize on GitHub</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    gap: spacing.lg,
  },
  brand: {
    width: 48, height: 48, borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
    marginTop: spacing.xxl,
  },
  logo: { color: '#fff', fontWeight: '800', fontSize: 22 },
  title: { ...type.h1, color: colors.text },
  subtitle: { ...type.body, color: colors.textMuted, lineHeight: 22 },

  codeBlock: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  codeLabel: { ...type.tiny, color: colors.textMuted, textTransform: 'uppercase' },
  code: {
    fontFamily: 'Menlo', fontSize: 28, fontWeight: '700',
    color: colors.text, letterSpacing: 4,
  },
  codeHint: { ...type.small, color: colors.textMuted, marginTop: spacing.xs },

  polling: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pollingText: { ...type.small, color: colors.textMuted },

  primaryBtn: {
    backgroundColor: colors.text,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 14,
    borderRadius: radii.md,
    marginTop: 'auto',
    marginBottom: spacing.lg,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
