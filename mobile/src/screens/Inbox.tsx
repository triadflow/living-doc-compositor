import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { EmptyState } from '../components';
import { addDoc } from '../registry';
import { colors, spacing, type, radii } from '../theme';

type InboxItem = {
  id: string;
  title: string;
  body: string;
  receivedAt: number;
  data?: Record<string, any>;
};

// Ephemeral session log. Persistent storage (SQLite) is a later ticket.
const inbox: InboxItem[] = [];

// When a push arrives carrying { url, title }, register the doc so Home updates
// automatically. Kept as a module-level helper so the side effect runs even if
// the Inbox screen isn't mounted.
async function onPushReceived(n: Notifications.Notification) {
  const c = n.request.content;
  const item: InboxItem = {
    id: n.request.identifier + ':' + Date.now(),
    title: c.title ?? 'Notification',
    body: c.body ?? '',
    receivedAt: Date.now(),
    data: (c.data as any) ?? {},
  };
  inbox.unshift(item);

  const data = item.data ?? {};
  if (typeof data.url === 'string' && data.url) {
    await addDoc({
      url: data.url,
      title: typeof data.title === 'string' && data.title ? data.title : item.title,
      source: typeof data.source === 'string' ? data.source : hostOf(data.url),
      status: typeof data.status === 'string' ? data.status : undefined,
    });
  }
}

function hostOf(url: string): string | undefined {
  try { return new URL(url).host; } catch { return undefined; }
}

export default function Inbox({ navigation }: any) {
  const [items, setItems] = useState<InboxItem[]>(inbox);

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(async (n) => {
      await onPushReceived(n);
      setItems([...inbox]);
    });

    const tapSub = Notifications.addNotificationResponseReceivedListener((r) => {
      const data = r.notification.request.content.data as any;
      if (data?.url) {
        navigation.navigate('DocDetail', {
          url: data.url,
          title: data.title ?? r.notification.request.content.title ?? 'Doc',
        });
      }
    });

    return () => {
      sub.remove();
      tapSub.remove();
    };
  }, [navigation]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Inbox</Text>
        <Text style={styles.headerSub}>
          {items.length ? `${items.length} notification${items.length === 1 ? '' : 's'}` : 'Nothing yet'}
        </Text>
      </View>

      {items.length === 0 ? (
        <EmptyState
          title="No notifications yet"
          body="When a GitHub Action from a connected repo fires, the notification shows up here."
          style={{ flex: 1 }}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => {
                if (item.data?.url) {
                  navigation.navigate('DocDetail', {
                    url: item.data.url,
                    title: item.data.title ?? item.title,
                  });
                }
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.itemTitle}>{item.title}</Text>
                <Text style={styles.itemBody} numberOfLines={2}>
                  {item.body}
                </Text>
                <Text style={styles.itemMeta}>{new Date(item.receivedAt).toLocaleString()}</Text>
              </View>
              <View style={styles.dot} />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: 2,
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: { ...type.h2, color: colors.text },
  headerSub: { ...type.small, color: colors.textMuted },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  itemTitle: { ...type.bodyStrong, color: colors.text },
  itemBody: { ...type.small, color: colors.textMuted, lineHeight: 18 },
  itemMeta: { ...type.tiny, color: colors.textSubtle, marginTop: 4 },
  dot: {
    width: 8, height: 8, borderRadius: radii.pill,
    backgroundColor: colors.accent,
    marginTop: 6,
  },
});
