import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, RefreshControl,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth';
import { listAdminRepos, getConnectionStatus, connectRepo, AdminRepo, ConnectionStatus } from '../github-api';
import { registerForPushNotifications } from '../notifications';
import { EmptyState, Pill } from '../components';
import { colors, radii, spacing, type } from '../theme';

type RepoState = AdminRepo & {
  status?: ConnectionStatus;
  loadingStatus?: boolean;
  connecting?: boolean;
};

export default function Repos() {
  const { token } = useAuth();
  const [repos, setRepos] = useState<RepoState[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);

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
    if (!pushToken) {
      Alert.alert(
        'Push token not available',
        'The app needs a push token before it can wire a repo. Enable notifications and try again.'
      );
      return;
    }
    setRepos((prev) =>
      prev ? prev.map((p) => (p.id === repo.id ? { ...p, connecting: true } : p)) : prev
    );
    try {
      await connectRepo(token, repo.owner, repo.name, pushToken);
      const status = await getConnectionStatus(token, repo.owner, repo.name);
      setRepos((prev) =>
        prev ? prev.map((p) => (p.id === repo.id ? { ...p, status, connecting: false } : p)) : prev
      );
    } catch (err: any) {
      setRepos((prev) =>
        prev ? prev.map((p) => (p.id === repo.id ? { ...p, connecting: false } : p)) : prev
      );
      Alert.alert('Connect failed', err.message ?? 'Unknown error');
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Connect a repository</Text>
        <Text style={styles.headerSub}>
          Any repo where you're an admin. Tap Connect to install the push secret and workflow file.
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
          renderItem={({ item }) => <RepoRow item={item} onConnect={() => onConnect(item)} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      )}
    </SafeAreaView>
  );
}

function RepoRow({ item, onConnect }: { item: RepoState; onConnect: () => void }) {
  const connected = item.status?.secret && item.status?.workflow && !item.status?.workflowOutdated;
  const partial = !connected && (item.status?.secret || item.status?.workflow);
  const needsUpdate = item.status?.workflow && item.status?.workflowOutdated;

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
        {item.description ? (
          <Text style={styles.rowDesc} numberOfLines={2}>{item.description}</Text>
        ) : null}
        <View style={styles.rowStatusLine}>
          {item.loadingStatus ? (
            <Text style={styles.rowMeta}>Checking...</Text>
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
        onPress={onConnect}
        disabled={item.connecting || (connected && !needsUpdate)}
        style={({ pressed }) => [
          styles.btn,
          connected && !needsUpdate && styles.btnGhost,
          pressed && !item.connecting && { opacity: 0.7 },
          item.connecting && { opacity: 0.6 },
        ]}
      >
        {item.connecting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : connected && !needsUpdate ? (
          <Ionicons name="checkmark" size={14} color={colors.success} />
        ) : (
          <Text style={styles.btnText}>{needsUpdate ? 'Update' : 'Connect'}</Text>
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
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
});
