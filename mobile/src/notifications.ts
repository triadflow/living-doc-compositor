import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { type InboxItem } from './inbox-store';
import { loadDocs } from './registry';
import { recordDeliveryEvent } from './delivery-ingest';

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
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    if (Constants.expoGoConfig || Constants.appOwnership === 'expo' || Constants.expoVersion) {
      return 'expo-go';
    }
    return 'eas';
  }
  if (
    Constants.executionEnvironment === ExecutionEnvironment.Standalone
    || Constants.executionEnvironment === ExecutionEnvironment.Bare
  ) {
    return 'eas';
  }
  return 'unknown';
}

export function pushRuntimeLabel(runtime: PushRuntime): string {
  switch (runtime) {
    case 'eas':
      return 'Native build';
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
  return recordDeliveryEvent(item);
}

export type PreviewDeliveryResult = {
  mode: 'local-notification' | 'inbox-only';
  usesDoc: boolean;
  title: string;
};

export async function sendPreviewNotification(): Promise<PreviewDeliveryResult> {
  const preview = await buildPreviewPayload();

  if (Platform.OS === 'web') {
    await recordNotificationContent(`preview-${Date.now()}`, preview.content);
    return {
      mode: 'inbox-only',
      usesDoc: preview.usesDoc,
      title: preview.content.title ?? 'Preview notification',
    };
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }

  if (status !== 'granted') {
    await recordNotificationContent(`preview-${Date.now()}`, preview.content);
    return {
      mode: 'inbox-only',
      usesDoc: preview.usesDoc,
      title: preview.content.title ?? 'Preview notification',
    };
  }

  try {
    await Notifications.scheduleNotificationAsync({
      content: preview.content,
      trigger: null,
    });
    return {
      mode: 'local-notification',
      usesDoc: preview.usesDoc,
      title: preview.content.title ?? 'Preview notification',
    };
  } catch {
    await recordNotificationContent(`preview-${Date.now()}`, preview.content);
    return {
      mode: 'inbox-only',
      usesDoc: preview.usesDoc,
      title: preview.content.title ?? 'Preview notification',
    };
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

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

async function buildPreviewPayload(): Promise<{
  content: Notifications.NotificationContentInput;
  usesDoc: boolean;
}> {
  const docs = await loadDocs();
  const latest = docs[0];

  if (!latest) {
    return {
      usesDoc: false,
      content: {
        title: 'Preview notification',
        body: 'Local preview delivery is active. Connect a repo or open a doc to test deep links later.',
        data: {
          source: 'Local preview',
          preview: true,
        },
      },
    };
  }

  return {
    usesDoc: true,
    content: {
      title: latest.title,
      body: 'Previewing local delivery for the latest registered doc on this device.',
      data: {
        url: latest.url,
        title: latest.title,
        source: latest.source ?? hostOf(latest.url) ?? 'Local preview',
        status: latest.status ?? 'Preview',
        preview: true,
      },
    },
  };
}

async function recordNotificationContent(
  id: string,
  content: Notifications.NotificationContentInput
): Promise<void> {
  const data = (content.data as Record<string, any> | undefined) ?? {};
  await recordDeliveryEvent({
    id,
    title: content.title ?? 'Notification',
    body: content.body ?? '',
    receivedAt: Date.now(),
    data,
  });
}
