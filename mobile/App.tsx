import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { AuthProvider } from './src/auth';
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
          <RootNavigator />
          <StatusBar style="dark" />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
