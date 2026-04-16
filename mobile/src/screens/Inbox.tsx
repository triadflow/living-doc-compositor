import React, { useCallback, useEffect, useState } from 'react';
import { Alert, View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth';
import { EmptyState } from '../components';
import { syncRepoDeliveryFeed } from '../github-api';
import {
  clear,
  list,
  markRead,
  remove,
  subscribe,
  type InboxItem,
} from '../inbox-store';
import { colors, spacing, type, radii } from '../theme';

export default function Inbox({ navigation }: any) {
  const { token } = useAuth();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [syncNote, setSyncNote] = useState<{
    tone: 'neutral' | 'warning' | 'success';
    text: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    setItems(await list());
  }, []);

  useEffect(() => {
    void refresh();
    const unsubscribe = subscribe(() => {
      void refresh();
    });
    return unsubscribe;
  }, [refresh]);

  const openItem = async (item: InboxItem) => {
    if (!item.read) {
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
      await markRead(item.id);
    }
    if (item.data?.url) {
      navigation.navigate('DocDetail', {
        url: item.data.url,
        title: item.data.title ?? item.title,
      });
    }
  };

  const removeItem = async (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    await remove(id);
  };

  const clearInbox = () => {
    Alert.alert(
      'Clear inbox?',
      'This removes all notification history from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear all',
          style: 'destructive',
          onPress: async () => {
            setItems([]);
            await clear();
          },
        },
      ]
    );
  };

  const onRefresh = async () => {
    setRefreshing(true);
    if (!token) {
      setSyncNote({
        tone: 'warning',
        text: 'Sign in with GitHub in Settings to sync repo updates.',
      });
    } else {
      const result = await syncRepoDeliveryFeed(token).catch((err: any) => {
        setSyncNote({
          tone: 'warning',
          text: `Sync failed: ${err?.message ?? 'Unknown error'}`,
        });
        return null;
      });
      if (result) {
        setSyncNote(syncNoteFromResult(result.repoNames, result.events));
      }
    }
    await refresh();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Inbox</Text>
            <Text style={styles.headerSub}>
              {items.length ? `${items.length} notification${items.length === 1 ? '' : 's'}` : 'Nothing yet'}
            </Text>
          </View>
          {items.length ? (
            <Pressable onPress={clearInbox} style={({ pressed }) => [styles.clearBtn, pressed && { opacity: 0.7 }]}>
              <Text style={styles.clearText}>Clear all</Text>
            </Pressable>
          ) : null}
        </View>
        {syncNote ? (
          <View
            style={[
              styles.syncNote,
              syncNote.tone === 'success'
                ? styles.syncNoteSuccess
                : syncNote.tone === 'warning'
                  ? styles.syncNoteWarning
                  : styles.syncNoteNeutral,
            ]}
          >
            <Text
              style={[
                styles.syncNoteText,
                syncNote.tone === 'success'
                  ? styles.syncNoteTextSuccess
                  : syncNote.tone === 'warning'
                    ? styles.syncNoteTextWarning
                    : styles.syncNoteTextNeutral,
              ]}
            >
              {syncNote.text}
            </Text>
          </View>
        ) : null}
      </View>

      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <EmptyState
            title="No updates yet"
            body="Connected repos sync new living-doc events into this inbox when the app refreshes."
            icon={<Ionicons name="notifications-outline" size={34} color={colors.neutralInk} />}
            style={{ flex: 1, paddingTop: 120 }}
          />
        }
        renderItem={({ item }) => (
          <Swipeable
            renderRightActions={() => <DeleteAction />}
            onSwipeableOpen={() => {
              void removeItem(item.id);
            }}
          >
            <Pressable
              style={styles.row}
              onPress={() => {
                void openItem(item);
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.itemTitle}>{item.title}</Text>
                <Text style={styles.itemBody} numberOfLines={2}>
                  {item.body}
                </Text>
                <Text style={styles.itemMeta}>{itemMeta(item)}</Text>
              </View>
              <View style={styles.dotSlot}>{item.read ? null : <View style={styles.dot} />}</View>
            </Pressable>
          </Swipeable>
        )}
      />
    </SafeAreaView>
  );
}

function itemMeta(item: InboxItem): string {
  return [formatRelative(item.receivedAt), sourceLabel(item)].filter(Boolean).join(' · ');
}

function formatRelative(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function sourceLabel(item: InboxItem): string | undefined {
  if (typeof item.data?.source === 'string' && item.data.source) return item.data.source;
  if (typeof item.data?.url !== 'string') return undefined;
  try {
    return new URL(item.data.url).host;
  } catch {
    return undefined;
  }
}

function DeleteAction() {
  return (
    <View style={styles.deleteAction}>
      <Text style={styles.deleteText}>Delete</Text>
    </View>
  );
}

function syncNoteFromResult(
  repoNames: string[],
  events: number
): { tone: 'neutral' | 'warning' | 'success'; text: string } {
  const repos = repoNames.length;
  if (repos === 0) {
    return {
      tone: 'warning',
      text: 'No connected repo feeds found. Open Repos to verify the workflow is installed.',
    };
  }
  if (events === 0) {
    return {
      tone: 'neutral',
      text: `Checked ${formatRepoNames(repoNames)}; no feed events found.`,
    };
  }
  return {
    tone: 'success',
    text: `Synced ${events} event${events === 1 ? '' : 's'} from ${formatRepoNames(repoNames)}.`,
  };
}

function formatRepoNames(repoNames: string[]): string {
  if (repoNames.length === 1) return repoNames[0];
  if (repoNames.length === 2) return `${repoNames[0]} and ${repoNames[1]}`;
  return `${repoNames[0]}, ${repoNames[1]}, and ${repoNames.length - 2} more repos`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
    gap: 2,
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerTitle: { ...type.h2, color: colors.text },
  headerSub: { ...type.small, color: colors.textMuted },
  syncNote: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: radii.md,
  },
  syncNoteNeutral: { backgroundColor: colors.neutralBg },
  syncNoteWarning: { backgroundColor: colors.warningBg },
  syncNoteSuccess: { backgroundColor: colors.successBg },
  syncNoteText: { ...type.small, fontSize: 12.5, lineHeight: 17.5 },
  syncNoteTextNeutral: { color: colors.neutralInk },
  syncNoteTextWarning: { color: colors.warning },
  syncNoteTextSuccess: { color: colors.success },
  clearBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radii.md,
    backgroundColor: colors.dangerBg,
  },
  clearText: { ...type.tiny, color: colors.danger, textTransform: 'uppercase' },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  itemTitle: { ...type.bodyStrong, fontSize: 14.5, color: colors.text },
  itemBody: { ...type.small, fontSize: 12.5, color: colors.textMuted, lineHeight: 18, marginTop: 3 },
  itemMeta: {
    ...type.tiny,
    fontSize: 10.5,
    color: colors.textSubtle,
    marginTop: 6,
    fontWeight: '600',
  },
  dotSlot: {
    width: 8,
    alignItems: 'center',
    marginTop: 6,
  },
  dot: {
    width: 8, height: 8, borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  deleteAction: {
    width: 92,
    backgroundColor: colors.dangerBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: { ...type.tiny, color: colors.danger, textTransform: 'uppercase' },
});
