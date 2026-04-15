import React, { useLayoutEffect, useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../theme';

export default function DocDetail({ route, navigation }: any) {
  const { url } = route.params as { url: string; title: string };
  const [loading, setLoading] = useState(true);
  const webRef = useRef<WebView>(null);

  const reload = () => webRef.current?.reload();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={reload}
          hitSlop={10}
          style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1, padding: spacing.xs }]}
        >
          <Ionicons name="refresh" size={22} color={colors.accent} />
        </Pressable>
      ),
    });
  }, [navigation]);

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <WebView
        ref={webRef}
        source={{ uri: url }}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        style={styles.web}
      />
      {loading ? (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  web: { flex: 1, backgroundColor: colors.bg },
  loading: {
    position: 'absolute', top: 0, left: 0, right: 0,
    padding: 8, alignItems: 'center',
  },
});
