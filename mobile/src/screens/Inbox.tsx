import React, { useCallback, useEffect, useState } from 'react';
import { Alert, View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import { EmptyState } from '../components';
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
  const [items, setItems] = useState<InboxItem[]>([]);

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
                  <Text style={styles.itemMeta}>{new Date(item.receivedAt).toLocaleString()}</Text>
                </View>
                <View style={styles.dotSlot}>{item.read ? null : <View style={styles.dot} />}</View>
              </Pressable>
            </Swipeable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function DeleteAction() {
  return (
    <View style={styles.deleteAction}>
      <Text style={styles.deleteText}>Delete</Text>
    </View>
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
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerTitle: { ...type.h2, color: colors.text },
  headerSub: { ...type.small, color: colors.textMuted },
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
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  itemTitle: { ...type.bodyStrong, color: colors.text },
  itemBody: { ...type.small, color: colors.textMuted, lineHeight: 18 },
  itemMeta: { ...type.tiny, color: colors.textSubtle, marginTop: 4 },
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
