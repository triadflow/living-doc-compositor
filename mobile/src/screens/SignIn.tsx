import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, Alert, Linking,
  TextInput, Platform, ScrollView, KeyboardAvoidingView,
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
  const { signInDevice, completeDeviceSignIn, signInWithToken } = useAuth();
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [pat, setPat] = useState('');
  const [patSubmitting, setPatSubmitting] = useState(false);

  const startDevice = async () => {
    setPhase({ name: 'requesting' });
    try {
      const code = await signInDevice();
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

  const authorizeDevice = async () => {
    if (phase.name !== 'waiting') return;
    await Clipboard.setStringAsync(phase.userCode);
    await Linking.openURL(phase.verificationUri);
    setPhase({ name: 'polling' });
    try {
      await completeDeviceSignIn(phase.deviceCode, phase.interval);
    } catch (err: any) {
      Alert.alert('Sign-in failed', err.message ?? 'Unknown error');
      setPhase({ name: 'idle' });
    }
  };

  const submitPat = async () => {
    setPatSubmitting(true);
    try {
      await signInWithToken(pat);
    } catch (err: any) {
      Alert.alert('Token rejected', err.message ?? 'Could not validate token.');
    } finally {
      setPatSubmitting(false);
    }
  };

  const isWeb = Platform.OS === 'web';

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <Text style={styles.logo}>L</Text>
          </View>
          <Text style={styles.title}>Living Docs</Text>
          <Text style={styles.subtitle}>
            Sign in with GitHub to open your living docs and receive notifications when they change.
          </Text>

          {!isWeb && phase.name === 'waiting' ? (
            <View style={styles.codeBlock}>
              <Text style={styles.codeLabel}>Your code</Text>
              <Text style={styles.code}>{phase.userCode}</Text>
              <Text style={styles.codeHint}>
                We copied it to your clipboard. Tap "Authorize on GitHub" to finish.
              </Text>
            </View>
          ) : null}

          {!isWeb && phase.name === 'polling' ? (
            <View style={styles.polling}>
              <ActivityIndicator />
              <Text style={styles.pollingText}>Waiting for GitHub authorization</Text>
            </View>
          ) : null}

          {!isWeb ? <View style={styles.spacer} /> : null}

          {!isWeb && (phase.name === 'idle' || phase.name === 'requesting') ? (
            <Pressable
              style={[styles.primaryBtn, phase.name === 'requesting' && { opacity: 0.6 }]}
              onPress={startDevice}
              disabled={phase.name === 'requesting'}
            >
              <Ionicons name="logo-github" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>Sign in with GitHub</Text>
            </Pressable>
          ) : null}

          {!isWeb && phase.name === 'waiting' ? (
            <Pressable style={styles.primaryBtn} onPress={authorizeDevice}>
              <Ionicons name="open-outline" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>Authorize on GitHub</Text>
            </Pressable>
          ) : null}

          {isWeb ? (
            <View style={styles.patBlock}>
              <Text style={styles.sectionLabel}>Browser sign-in</Text>
              <Text style={styles.helpText}>
                GitHub's device flow is blocked by CORS in browsers. Paste a personal access token
                with <Text style={styles.mono}>read:user</Text> and <Text style={styles.mono}>repo</Text> scopes.
              </Text>
              <Pressable
                onPress={() => Linking.openURL('https://github.com/settings/tokens/new?description=Living%20Docs%20Web&scopes=repo,read:user')}
              >
                <Text style={styles.link}>Create a token →</Text>
              </Pressable>
              <TextInput
                value={pat}
                onChangeText={setPat}
                placeholder="ghp_... or github_pat_..."
                placeholderTextColor={colors.textSubtle}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={styles.patInput}
              />
              <Pressable
                style={[styles.primaryBtn, patSubmitting && { opacity: 0.6 }]}
                onPress={submitPat}
                disabled={patSubmitting || !pat.trim()}
              >
                {patSubmitting ? <ActivityIndicator color="#fff" /> : <Ionicons name="log-in-outline" size={18} color="#fff" />}
                <Text style={styles.primaryBtnText}>Sign in with token</Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: 20,
    paddingBottom: spacing.xl,
    gap: 18,
  },
  brand: {
    width: 48, height: 48, borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 20,
  },
  logo: { color: '#fff', fontWeight: '800', fontSize: 22 },
  title: { ...type.h1, color: colors.text },
  subtitle: { ...type.body, color: colors.textMuted, lineHeight: 22 },

  codeBlock: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 20,
    marginTop: spacing.sm,
  },
  codeLabel: { ...type.tiny, color: colors.textMuted, textTransform: 'uppercase' },
  code: {
    fontFamily: 'Menlo', fontSize: 30, fontWeight: '700',
    color: colors.text, letterSpacing: 4, marginTop: 10,
  },
  codeHint: { ...type.small, color: colors.textMuted, marginTop: 10, lineHeight: 19 },

  polling: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pollingText: { fontSize: 14, fontWeight: '400', color: colors.textMuted },
  spacer: { flex: 1 },

  primaryBtn: {
    backgroundColor: colors.text,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 14,
    borderRadius: radii.md,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  patBlock: {
    marginTop: spacing.md,
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
  },
  sectionLabel: { ...type.tiny, color: colors.textMuted, textTransform: 'uppercase' },
  helpText: { ...type.small, color: colors.textMuted, lineHeight: 18 },
  mono: { fontFamily: 'Menlo', color: colors.text },
  link: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  patInput: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontFamily: 'Menlo',
    fontSize: 13,
    color: colors.text,
    marginTop: spacing.xs,
  },
});
