import React, { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { AuthProvider, useAuth } from './src/auth';
import { syncRepoDeliveryFeed } from './src/github-api';
import RootNavigator, { navigationRef } from './src/navigation';
import { markRead } from './src/inbox-store';
import { notificationDocRoute, recordNotification } from './src/notifications';

export default function App() {
  useEffect(() => {
    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      void recordNotification(notification);
    });

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      void (async () => {
        const item = await recordNotification(response.notification);
        await markRead(item.id);

        const route = notificationDocRoute(response.notification);
        if (route && navigationRef.isReady()) {
          navigationRef.navigate('DocDetail', route);
        }
      })();
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <RepoFeedSyncController />
          <RootNavigator />
          <StatusBar style="dark" />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RepoFeedSyncController() {
  const { token } = useAuth();
  const syncing = useRef(false);

  useEffect(() => {
    if (!token) return;

    const runSync = async () => {
      if (syncing.current) return;
      syncing.current = true;
      try {
        await syncRepoDeliveryFeed(token);
      } finally {
        syncing.current = false;
      }
    };

    void runSync();

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        void runSync();
      }
    });

    return () => {
      sub.remove();
    };
  }, [token]);

  return null;
}
