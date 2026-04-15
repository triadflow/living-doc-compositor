import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, RefreshControl, Pressable, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { DocCard, EmptyState } from '../components';
import { loadDocs, removeDoc, RegisteredDoc } from '../registry';
import { colors, spacing, type } from '../theme';

export default function Home({ navigation }: any) {
  const [docs, setDocs] = useState<RegisteredDoc[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setDocs(await loadDocs());
  }, []);

  useEffect(() => {
    load();
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [load, navigation]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const onLongPress = (doc: RegisteredDoc) => {
    Alert.alert('Remove this doc?', doc.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await removeDoc(doc.id);
          load();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Living Docs</Text>
        <Text style={styles.headerSub}>
          {docs === null
            ? 'Loading...'
            : docs.length === 0
              ? 'Nothing registered yet'
              : `${docs.length} document${docs.length === 1 ? '' : 's'}`}
        </Text>
      </View>

      {docs === null ? (
        <View style={styles.loading} />
      ) : docs.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            title="No docs yet"
            body="Docs appear here when a GitHub Action pushes to this device. Connect a repository from Settings to get started."
          />
          <Pressable
            style={styles.primaryBtn}
            onPress={() => navigation.navigate('Repos')}
          >
            <Ionicons name="git-branch-outline" size={16} color="#fff" />
            <Text style={styles.primaryBtnText}>Connect a repository</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={docs}
          keyExtractor={(d) => d.id}
          renderItem={({ item }) => (
            <DocCard
              title={item.title}
              category={item.source ?? 'Doc'}
              meta={formatRelative(item.addedAt)}
              onPress={() =>
                navigation.navigate('DocDetail', {
                  title: item.title,
                  url: item.url,
                })
              }
              onLongPress={() => onLongPress(item)}
            />
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      )}
    </SafeAreaView>
  );
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

  loading: { flex: 1 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xl },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.text,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
