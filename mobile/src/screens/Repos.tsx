import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, RefreshControl,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth';
import {
  listAdminRepos,
  getConnectionStatus,
  connectRepo,
  disconnectRepo,
  AdminRepo,
  ConnectionStatus,
} from '../github-api';
import {
  PREVIEW_PUSH_TOKEN,
  pushRuntime,
  pushRuntimeLabel,
  registerForPushNotifications,
} from '../notifications';
import { EmptyState, Pill } from '../components';
import { colors, radii, spacing, type } from '../theme';

type Toast = { kind: 'progress' | 'success' | 'warning' | 'error'; text: string } | null;
type ConnectionMode = 'real' | 'preview';

type RepoState = AdminRepo & {
  status?: ConnectionStatus;
  connectionMode?: ConnectionMode;
  loadingStatus?: boolean;
  connecting?: boolean;
  disconnecting?: boolean;
};

export default function Repos() {
  const { token } = useAuth();
  const runtime = pushRuntime();
  const [repos, setRepos] = useState<RepoState[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (t: Toast, autoHideMs?: number) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    if (autoHideMs) {
      toastTimer.current = setTimeout(() => setToast(null), autoHideMs);
    }
  };

  const loadRepos = useCallback(async () => {
    if (!token) return;
    try {
      setError(null);
      const list = await listAdminRepos(token);
      setRepos(list.map((r) => ({ ...r, loadingStatus: true })));
      // Hydrate connection status in parallel.
      await Promise.all(
        list.map(async (r) => {
          try {
            const status = await getConnectionStatus(token, r.owner, r.name);
            setRepos((prev) =>
              prev ? prev.map((p) => (p.id === r.id ? { ...p, status, loadingStatus: false } : p)) : prev
            );
          } catch {
            setRepos((prev) =>
              prev ? prev.map((p) => (p.id === r.id ? { ...p, loadingStatus: false } : p)) : prev
            );
          }
        })
      );
    } catch (err: any) {
      setError(err.message ?? 'Failed to load repos');
    }
  }, [token]);

  useEffect(() => {
    loadRepos();
    (async () => setPushToken(await registerForPushNotifications()))();
  }, [loadRepos]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadRepos();
    setRefreshing(false);
  };

  const onConnect = async (repo: RepoState) => {
    if (!token) return;
    const connectionMode: ConnectionMode = pushToken ? 'real' : 'preview';
    const effectiveToken = pushToken ?? PREVIEW_PUSH_TOKEN;

    setRepos((prev) =>
      prev ? prev.map((p) => (p.id === repo.id ? { ...p, connecting: true } : p)) : prev
    );
    showToast({ kind: 'progress', text: 'Installing secret and workflow...' });
    try {
      await connectRepo(token, repo.owner, repo.name, effectiveToken);
      const status = await getConnectionStatus(token, repo.owner, repo.name);
      setRepos((prev) =>
        prev
          ? prev.map((p) =>
              p.id === repo.id
                ? { ...p, status, connectionMode, connecting: false }
                : p
            )
          : prev
      );
      showToast(
        {
          kind: connectionMode === 'preview' ? 'warning' : 'success',
          text: connectionMode === 'preview'
            ? 'Wired for preview. Install an EAS build to activate pushes.'
            : 'Connected. Pushes from this repo will arrive here.',
        },
        4000
      );
    } catch (err: any) {
      setRepos((prev) =>
        prev ? prev.map((p) => (p.id === repo.id ? { ...p, connecting: false } : p)) : prev
      );
      showToast(
        { kind: 'error', text: `Connect failed: ${err.message ?? 'Unknown error'}` },
        4500
      );
    }
  };

  const onDisconnect = async (repo: RepoState, removeWorkflow: boolean) => {
    if (!token) return;

    setRepos((prev) =>
      prev ? prev.map((p) => (p.id === repo.id ? { ...p, disconnecting: true } : p)) : prev
    );
    showToast({ kind: 'progress', text: 'Disconnecting...' });

    try {
      await disconnectRepo(token, repo.owner, repo.name, { removeWorkflow });
      const status = await getConnectionStatus(token, repo.owner, repo.name);
      setRepos((prev) =>
        prev
          ? prev.map((p) =>
              p.id === repo.id
                ? { ...p, status, connectionMode: undefined, disconnecting: false }
                : p
            )
          : prev
      );
      showToast({ kind: 'success', text: 'Disconnected.' }, 3500);
    } catch (err: any) {
      setRepos((prev) =>
        prev ? prev.map((p) => (p.id === repo.id ? { ...p, disconnecting: false } : p)) : prev
      );
      showToast(
        { kind: 'error', text: `Disconnect failed: ${err.message ?? 'Unknown error'}` },
        4500
      );
    }
  };

  const openRepoActions = (repo: RepoState) => {
    Alert.alert(
      `Disconnect ${repo.fullName}?`,
      'Choose how much of the Living Docs connection to remove.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            void onDisconnect(repo, false);
          },
        },
        {
          text: 'Remove workflow file',
          style: 'destructive',
          onPress: () => {
            void onDisconnect(repo, true);
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Connect a repository</Text>
        <Text style={styles.headerSub}>
          {pushToken
            ? 'Any repo where you are an admin. Tap Connect to install the push secret and workflow file.'
            : `Running in ${pushRuntimeLabel(runtime)}. Repo setup can be wired for preview, but real pushes need an EAS build token.`}
        </Text>
      </View>

      {error ? (
        <EmptyState title="Could not load repos" body={error} style={{ flex: 1 }} />
      ) : repos === null ? (
        <View style={styles.loading}><ActivityIndicator /></View>
      ) : repos.length === 0 ? (
        <EmptyState
          title="No admin repos"
          body="You need admin access on a repo to install a push secret. Create one or request admin on an existing repo."
          style={{ flex: 1 }}
        />
      ) : (
        <FlatList
          data={repos}
          keyExtractor={(r) => String(r.id)}
          renderItem={({ item }) => (
            <RepoRow
              item={item}
              hasRealPushToken={Boolean(pushToken)}
              onConnect={() => onConnect(item)}
              onActions={() => openRepoActions(item)}
            />
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      )}
      {toast ? <ToastBanner toast={toast} onClose={() => showToast(null)} /> : null}
    </SafeAreaView>
  );
}

function ToastBanner({ toast, onClose }: { toast: NonNullable<Toast>; onClose: () => void }) {
  const palette = toast.kind === 'success'
    ? { bg: colors.success, fg: '#fff' }
    : toast.kind === 'warning'
      ? { bg: colors.warningBg, fg: colors.warning }
      : toast.kind === 'error'
        ? { bg: colors.danger, fg: '#fff' }
        : { bg: colors.text, fg: '#fff' };
  return (
    <Pressable onPress={onClose} style={[styles.toast, { backgroundColor: palette.bg }]}>
      {toast.kind === 'progress' ? (
        <ActivityIndicator color={palette.fg} size="small" />
      ) : toast.kind === 'success' ? (
        <Ionicons name="checkmark" size={18} color={palette.fg} />
      ) : (
        <Ionicons name="alert-circle-outline" size={18} color={palette.fg} />
      )}
      <Text style={[styles.toastText, { color: palette.fg }]}>{toast.text}</Text>
    </Pressable>
  );
}

function RepoRow({
  item,
  hasRealPushToken,
  onConnect,
  onActions,
}: {
  item: RepoState;
  hasRealPushToken: boolean;
  onConnect: () => void;
  onActions: () => void;
}) {
  const connected = item.status?.secret && item.status?.workflow && !item.status?.workflowOutdated;
  const partial = !connected && (item.status?.secret || item.status?.workflow);
  const needsUpdate = item.status?.workflow && item.status?.workflowOutdated;
  const previewConnected = connected && (item.connectionMode === 'preview' || !hasRealPushToken);
  const showActions = connected && !needsUpdate;

  return (
    <View style={styles.row}>
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <Ionicons
            name={item.isPrivate ? 'lock-closed-outline' : 'book-outline'}
            size={14}
            color={colors.textMuted}
          />
          <Text style={styles.rowTitle} numberOfLines={1}>
            {item.fullName}
          </Text>
        </View>
        <Text style={styles.rowDesc} numberOfLines={1}>
          {item.description || 'No description'}
        </Text>
        <View style={styles.rowStatusLine}>
          {item.loadingStatus ? (
            <Text style={styles.rowMeta}>Checking...</Text>
          ) : previewConnected ? (
            <Pill tone="warning">Preview-connected</Pill>
          ) : connected ? (
            <Pill tone="success">Connected</Pill>
          ) : needsUpdate ? (
            <Pill tone="warning">Workflow outdated</Pill>
          ) : partial ? (
            <Pill tone="warning">Partial</Pill>
          ) : (
            <Pill>Not connected</Pill>
          )}
        </View>
      </View>
      <Pressable
        onPress={showActions ? onActions : onConnect}
        disabled={item.connecting || item.disconnecting}
        style={({ pressed }) => [
          styles.btn,
          showActions && styles.btnGhost,
          pressed && !item.connecting && !item.disconnecting && { opacity: 0.7 },
          (item.connecting || item.disconnecting) && { opacity: 0.6 },
        ]}
      >
        {item.connecting || item.disconnecting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : showActions ? (
          <Ionicons name="ellipsis-horizontal" size={16} color={colors.accent} />
        ) : (
          <Text style={styles.btnText}>
            {needsUpdate ? 'Update' : connected ? 'Reconnect' : 'Connect'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: 4,
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: { ...type.h2, color: colors.text },
  headerSub: { ...type.small, color: colors.textMuted, lineHeight: 18 },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  rowBody: { flex: 1, gap: 4 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { ...type.bodyStrong, color: colors.text, flexShrink: 1 },
  rowDesc: { ...type.small, color: colors.textMuted, lineHeight: 18 },
  rowStatusLine: { marginTop: 4, flexDirection: 'row' },
  rowMeta: { ...type.small, color: colors.textSubtle },

  btn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: {
    backgroundColor: colors.successBg,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  toast: {
    position: 'absolute',
    left: spacing.lg, right: spacing.lg,
    bottom: spacing.xl,
    paddingVertical: 12, paddingHorizontal: 16,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  toastText: { fontSize: 13, fontWeight: '500', flex: 1 },
});
