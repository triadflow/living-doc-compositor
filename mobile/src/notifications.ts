import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { insert, type InboxItem } from './inbox-store';
import { addDoc } from './registry';

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

export function inboxItemFromNotification(
  notification: Notifications.Notification
): Omit<InboxItem, 'read'> {
  const content = notification.request.content;
  return {
    id: notification.request.identifier,
    title: content.title ?? 'Notification',
    body: content.body ?? '',
    receivedAt: Date.now(),
    data: (content.data as Record<string, any>) ?? {},
  };
}

export function notificationDocRoute(
  notification: Notifications.Notification
): { url: string; title: string } | null {
  const content = notification.request.content;
  const data = content.data as Record<string, any> | undefined;
  if (typeof data?.url !== 'string' || !data.url) return null;
  return {
    url: data.url,
    title: typeof data.title === 'string' && data.title ? data.title : content.title ?? 'Doc',
  };
}

export async function recordNotification(
  notification: Notifications.Notification
): Promise<InboxItem> {
  const item = inboxItemFromNotification(notification);
  await insert(item);

  const data = item.data ?? {};
  if (typeof data.url === 'string' && data.url) {
    await addDoc({
      url: data.url,
      title: typeof data.title === 'string' && data.title ? data.title : item.title,
      source: typeof data.source === 'string' ? data.source : hostOf(data.url),
      status: typeof data.status === 'string' ? data.status : undefined,
    });
  }

  return { ...item, read: false };
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

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}
