import React, { useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { colors } from '../theme';

export default function DocDetail({ route }: any) {
  const { url } = route.params as { url: string; title: string };
  const [loading, setLoading] = useState(true);
  const [cacheBuster, setCacheBuster] = useState(0);
  const webRef = useRef<WebView>(null);

  const onRefresh = () => {
    setCacheBuster((n) => n + 1);
    webRef.current?.reload();
  };

  const finalUrl = cacheBuster ? `${url}?r=${cacheBuster}` : url;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <WebView
        ref={webRef}
        source={{ uri: finalUrl }}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        style={styles.web}
        pullToRefreshEnabled
        onRefresh={onRefresh}
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
