import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export type PushRuntime = 'eas' | 'expo-go' | 'web' | 'unknown';

export const PREVIEW_PUSH_TOKEN = 'ExponentPushToken[placeholder-install-eas-build]';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function pushRuntime(): PushRuntime {
  if (Platform.OS === 'web') return 'web';
  if (Constants.appOwnership === 'expo') return 'expo-go';
  return 'eas';
}

export function pushRuntimeLabel(runtime: PushRuntime): string {
  switch (runtime) {
    case 'eas':
      return 'EAS build';
    case 'expo-go':
      return 'Expo Go';
    case 'web':
      return 'Web preview';
    default:
      return 'Unknown runtime';
  }
}

// Register the device for push and return the Expo push token.
// The token is what a GitHub Action posts to to deliver a notification.
export async function registerForPushNotifications(): Promise<string | null> {
  if (pushRuntime() !== 'eas') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#0969da',
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== 'granted') return null;

  // EAS projectId is required for push tokens; returns null if not configured.
  const projectId = Constants.expoConfig?.extra?.eas?.projectId
    ?? (Constants as any).easConfig?.projectId;
  try {
    const token = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return token.data;
  } catch {
    return null;
  }
}
