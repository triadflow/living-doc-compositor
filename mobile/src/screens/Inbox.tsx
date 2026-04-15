import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { EmptyState } from '../components';
import { colors, spacing, type, radii } from '../theme';

type InboxItem = {
  id: string;
  title: string;
  body: string;
  receivedAt: number;
  data?: Record<string, any>;
};

// In-memory inbox for MVP — real storage (SecureStore or SQLite) can come later.
const inbox: InboxItem[] = [];

export default function Inbox({ navigation }: any) {
  const [items, setItems] = useState<InboxItem[]>(inbox);

  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((n) => {
      const c = n.request.content;
      const item: InboxItem = {
        id: n.request.identifier + ':' + Date.now(),
        title: c.title ?? 'Notification',
        body: c.body ?? '',
        receivedAt: Date.now(),
        data: (c.data as any) ?? {},
      };
      inbox.unshift(item);
      setItems([...inbox]);
    });

    const tapSub = Notifications.addNotificationResponseReceivedListener((r) => {
      const data = r.notification.request.content.data as any;
      if (data?.url && data?.title) {
        navigation.navigate('DocDetail', { url: data.url, title: data.title });
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
          body="When a GitHub Action runs a living-doc skill, you'll see it here."
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
                if (item.data?.url && item.data?.title) {
                  navigation.navigate('DocDetail', {
                    url: item.data.url,
                    title: item.data.title,
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
