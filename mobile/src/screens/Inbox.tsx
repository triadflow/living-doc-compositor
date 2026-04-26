import React, { useCallback, useEffect, useState } from 'react';
import { Alert, View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth';
import { EmptyState, Pill } from '../components';
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
        title: item.data.docTitle ?? item.data.title ?? item.title,
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
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => {
                void onRefresh();
              }}
              disabled={refreshing}
              style={({ pressed }) => [
                styles.refreshBtn,
                (pressed || refreshing) && { opacity: 0.7 },
              ]}
            >
              <Ionicons name="refresh" size={14} color={colors.accent} />
              <Text style={styles.refreshText}>{refreshing ? 'Syncing' : 'Refresh'}</Text>
            </Pressable>
            {items.length ? (
              <Pressable
                onPress={clearInbox}
                style={({ pressed }) => [styles.clearBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.clearText}>Clear all</Text>
              </Pressable>
            ) : null}
          </View>
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
                {itemContext(item) ? <Text style={styles.itemContext}>{itemContext(item)}</Text> : null}
                <Text style={styles.itemTitle}>{item.title}</Text>
                {itemPills(item).length ? (
                  <View style={styles.pillRow}>
                    {itemPills(item).map((pill) => (
                      <Pill key={`${item.id}-${pill.label}`} tone={pill.tone}>
                        {pill.label}
                      </Pill>
                    ))}
                  </View>
                ) : null}
                <Text style={styles.itemBody} numberOfLines={2}>
                  {item.body}
                </Text>
                {itemDetail(item) ? (
                  <Text style={styles.itemDetail} numberOfLines={2}>
                    {itemDetail(item)}
                  </Text>
                ) : null}
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

function itemContext(item: InboxItem): string | undefined {
  const parts = [
    readString(item.data?.blockTitle),
    readString(item.data?.audience),
    transitionLabel(item),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

function itemDetail(item: InboxItem): string | undefined {
  const parts: string[] = [];
  const blockSummary = readString(item.data?.blockSummary);
  const intentSummary = readString((item.data?.intent as any)?.summary);
  const honestStatus = readString(item.data?.honestStatus);
  const groundingWarning = readString(item.data?.groundingWarning)
    || readString((item.data?.grounding as any)?.summary);
  const evidenceCount = Array.isArray(item.data?.evidence) ? item.data.evidence.length : 0;
  const openQuestionCount = Array.isArray(item.data?.openQuestions) ? item.data.openQuestions.length : 0;

  if (blockSummary) parts.push(blockSummary);
  if (intentSummary) parts.push(`Intent: ${intentSummary}`);
  if (honestStatus) parts.push(`Status: ${honestStatus}`);
  if (evidenceCount > 0) parts.push(`Evidence: ${evidenceCount}`);
  if (openQuestionCount > 0) parts.push(`Open questions: ${openQuestionCount}`);
  if (groundingWarning) parts.push(groundingWarning);

  return parts.length ? parts.join(' · ') : undefined;
}

function itemPills(
  item: InboxItem
): Array<{ label: string; tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' }> {
  const pills: Array<{ label: string; tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' }> = [];

  const transition = item.data?.transition;
  const transitionLabelValue = transitionLabel(item);
  if (transitionLabelValue) {
    pills.push({
      label: transitionLabelValue,
      tone: toneFromValue(readString(transition?.tone) || transitionLabelValue),
    });
  }

  const honestStatus = readString(item.data?.honestStatus);
  if (honestStatus) {
    pills.push({
      label: honestStatus,
      tone: toneFromValue(honestStatus),
    });
  } else if (typeof item.data?.status === 'string' && item.data.status) {
    pills.push({
      label: item.data.status,
      tone: toneFromValue(item.data.status),
    });
  }

  const groundingStatus = readString((item.data?.grounding as any)?.status);
  if (groundingStatus) {
    pills.push({
      label: groundingStatus,
      tone: toneFromValue(groundingStatus),
    });
  } else if (readString(item.data?.groundingWarning)) {
    pills.push({
      label: 'Needs grounding',
      tone: 'warning',
    });
  }

  return pills.slice(0, 3);
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

function transitionLabel(item: InboxItem): string | undefined {
  const transition = item.data?.transition;
  if (!transition || typeof transition !== 'object' || Array.isArray(transition)) return undefined;
  return readString((transition as any).label)
    || [readString((transition as any).from), readString((transition as any).to)]
      .filter(Boolean)
      .join(' → ')
    || undefined;
}

function toneFromValue(value: string): 'neutral' | 'accent' | 'success' | 'warning' | 'danger' {
  const v = value.toLowerCase();
  if (/\b(ship|done|ready|green|ok|resolved|grounded|success|improved|progress)\b/.test(v)) {
    return 'success';
  }
  if (/\b(regress|blocked|red|danger|error|fail|broken)\b/.test(v)) {
    return 'danger';
  }
  if (/\b(warn|partial|review|needs|question|contested|stale|preview)\b/.test(v)) {
    return 'warning';
  }
  if (/\b(update|updated|doc-change|progressing|active)\b/.test(v)) {
    return 'accent';
  }
  return 'neutral';
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
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
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radii.md,
    backgroundColor: colors.accentBg,
  },
  refreshText: { ...type.tiny, color: colors.accent, textTransform: 'uppercase' },
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
  itemContext: {
    ...type.tiny,
    fontSize: 10.5,
    color: colors.textSubtle,
    textTransform: 'uppercase',
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 4,
  },
  itemBody: { ...type.small, fontSize: 12.5, color: colors.textMuted, lineHeight: 18, marginTop: 3 },
  itemDetail: {
    ...type.small,
    fontSize: 11.5,
    color: colors.textMuted,
    lineHeight: 17,
    marginTop: 4,
  },
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
