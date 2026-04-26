import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, Alert, Linking,
  Platform, ScrollView, KeyboardAvoidingView,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth';
import { storage } from '../storage';
import { colors, radii, spacing, type } from '../theme';

const PENDING_DEVICE_SIGN_IN_KEY = 'github_pending_device_sign_in';

type DevicePhasePayload = {
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  deviceCode: string;
  interval: number;
  expiresAt: number;
};

type PendingDeviceSignIn = DevicePhasePayload & {
  status: 'waiting' | 'polling';
};

type Phase =
  | { name: 'idle' }
  | { name: 'requesting' }
  | ({ name: 'waiting' } & DevicePhasePayload)
  | ({ name: 'polling' } & DevicePhasePayload);

function isExpired(expiresAt: number): boolean {
  return expiresAt <= Date.now();
}

function pendingFromPhase(
  phase: Extract<Phase, { name: 'waiting' | 'polling' }>
): PendingDeviceSignIn {
  return {
    status: phase.name,
    userCode: phase.userCode,
    verificationUri: phase.verificationUri,
    verificationUriComplete: phase.verificationUriComplete,
    deviceCode: phase.deviceCode,
    interval: phase.interval,
    expiresAt: phase.expiresAt,
  };
}

function phaseFromPending(pending: PendingDeviceSignIn): Extract<Phase, { name: 'waiting' | 'polling' }> {
  return {
    name: pending.status,
    userCode: pending.userCode,
    verificationUri: pending.verificationUri,
    verificationUriComplete: pending.verificationUriComplete,
    deviceCode: pending.deviceCode,
    interval: pending.interval,
    expiresAt: pending.expiresAt,
  };
}

export default function SignIn() {
  const { signInDevice, completeDeviceSignIn } = useAuth();
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const pollingRef = useRef(false);

  const clearPending = async () => {
    await storage.remove(PENDING_DEVICE_SIGN_IN_KEY);
  };

  const persistPending = async (pending: PendingDeviceSignIn) => {
    await storage.set(PENDING_DEVICE_SIGN_IN_KEY, JSON.stringify(pending));
  };

  const restorePending = async (): Promise<PendingDeviceSignIn | null> => {
    const raw = await storage.get(PENDING_DEVICE_SIGN_IN_KEY);
    if (!raw) return null;
    try {
      const pending = JSON.parse(raw) as PendingDeviceSignIn;
      if (isExpired(pending.expiresAt)) {
        await clearPending();
        return null;
      }
      return pending;
    } catch {
      await clearPending();
      return null;
    }
  };

  const finishPendingSignIn = async (
    pending: PendingDeviceSignIn,
    options?: { dismissBrowserOnSuccess?: boolean }
  ) => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    const nextPhase = phaseFromPending({ ...pending, status: 'polling' });
    setPhase(nextPhase);
    await persistPending({ ...pending, status: 'polling' });
    try {
      await completeDeviceSignIn(pending.deviceCode, pending.interval);
      await clearPending();
      if (options?.dismissBrowserOnSuccess) {
        try {
          WebBrowser.dismissBrowser();
        } catch {}
      }
    } catch (err: any) {
      await clearPending();
      Alert.alert('Sign-in failed', err.message ?? 'Unknown error');
      setPhase({ name: 'idle' });
    } finally {
      pollingRef.current = false;
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pending = await restorePending();
      if (!pending || cancelled) return;
      const restored = phaseFromPending(pending);
      setPhase(restored);
      if (pending.status === 'polling') {
        void finishPendingSignIn(pending);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startDevice = async () => {
    setPhase({ name: 'requesting' });
    try {
      const code = await signInDevice();
      const nextPhase: Extract<Phase, { name: 'waiting' }> = {
        name: 'waiting',
        userCode: code.userCode,
        verificationUri: code.verificationUri,
        verificationUriComplete: code.verificationUriComplete,
        deviceCode: code.deviceCode,
        interval: code.interval,
        expiresAt: Date.now() + code.expiresIn * 1000,
      };
      setPhase(nextPhase);
      await persistPending(pendingFromPhase(nextPhase));
    } catch (err: any) {
      Alert.alert('Sign-in failed', err.message ?? 'Unknown error');
      setPhase({ name: 'idle' });
    }
  };

  const authorizeDevice = async () => {
    if (phase.name !== 'waiting') return;
    await Clipboard.setStringAsync(phase.userCode);
    const pending = pendingFromPhase(phase);
    const verificationUrl = phase.verificationUriComplete ?? phase.verificationUri;
    try {
      let browserPromise: Promise<WebBrowser.WebBrowserResult> | null = null;
      let dismissBrowserOnSuccess = false;

      try {
        browserPromise = WebBrowser.openBrowserAsync(verificationUrl);
        dismissBrowserOnSuccess = true;
      } catch {
        await Linking.openURL(verificationUrl);
      }

      const signInPromise = finishPendingSignIn(pending, { dismissBrowserOnSuccess });
      if (browserPromise) {
        await Promise.all([browserPromise, signInPromise]);
      } else {
        await signInPromise;
      }
    } catch (err: any) {
      await clearPending();
      Alert.alert('Sign-in failed', err.message ?? 'Unknown error');
      setPhase({ name: 'idle' });
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
                We copied it to your clipboard. Tap "Authorize on GitHub" to finish. If Expo Go
                reloads while GitHub is open, this sign-in will resume when you come back.
              </Text>
            </View>
          ) : null}

          {!isWeb && phase.name === 'polling' ? (
            <View style={styles.polling}>
              <ActivityIndicator />
              <Text style={styles.pollingText}>
                Waiting for GitHub authorization. When approval succeeds, the app will continue
                automatically.
              </Text>
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
            <View style={styles.webBlock}>
              <Text style={styles.sectionLabel}>Browser preview</Text>
              <Text style={styles.helpText}>
                Normal GitHub sign-in is not available in browser preview yet. This app uses
                device flow on native, and the proper web OAuth callback flow has not been added
                yet.
              </Text>
              <Text style={styles.helpText}>
                Use Expo Go, an emulator, or an EAS development build to sign in with GitHub and
                connect repos.
              </Text>
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

  webBlock: {
    marginTop: spacing.md,
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
  },
  sectionLabel: { ...type.tiny, color: colors.textMuted, textTransform: 'uppercase' },
  helpText: { ...type.small, color: colors.textMuted, lineHeight: 18 },
});
