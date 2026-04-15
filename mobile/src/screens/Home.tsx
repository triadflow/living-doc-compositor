import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth';
import { listDocs, categoryFor, DocSummary } from '../github';
import { DocCard, EmptyState } from '../components';
import { colors, spacing, type } from '../theme';

export default function Home({ navigation }: any) {
  const { token } = useAuth();
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setError(null);
      const next = await listDocs(token);
      setDocs(next);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load docs');
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Living Docs</Text>
        <Text style={styles.headerSub}>
          {docs ? `${docs.length} document${docs.length === 1 ? '' : 's'}` : 'Loading...'}
        </Text>
      </View>

      {error ? (
        <EmptyState title="Could not load docs" body={error} style={{ flex: 1 }} />
      ) : docs === null ? (
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      ) : docs.length === 0 ? (
        <EmptyState
          title="No docs yet"
          body="Render a living doc and push it to the docs/ folder to see it here."
          style={{ flex: 1 }}
        />
      ) : (
        <FlatList
          data={docs}
          keyExtractor={(d) => d.slug}
          renderItem={({ item }) => (
            <DocCard
              title={item.title}
              category={categoryFor(item.slug)}
              meta={item.slug}
              onPress={() =>
                navigation.navigate('DocDetail', {
                  title: item.title,
                  url: item.pagesUrl,
                })
              }
            />
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
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

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
