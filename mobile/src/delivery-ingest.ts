import { insert, type InboxItem } from './inbox-store';
import { addDoc } from './registry';

export type DeliveryEventInput = {
  id: string;
  title: string;
  body: string;
  receivedAt: number;
  data?: Record<string, any>;
};

export async function recordDeliveryEvent(
  event: DeliveryEventInput
): Promise<InboxItem> {
  await insert({
    id: event.id,
    title: event.title,
    body: event.body,
    receivedAt: event.receivedAt,
    data: event.data,
  });

  const data = event.data ?? {};
  if (typeof data.url === 'string' && data.url) {
    await addDoc({
      url: data.url,
      title:
        typeof data.docTitle === 'string' && data.docTitle
          ? data.docTitle
          : typeof data.title === 'string' && data.title
            ? data.title
            : event.title || 'Doc',
      source: typeof data.source === 'string' ? data.source : hostOf(data.url),
      status: typeof data.status === 'string' ? data.status : undefined,
    });
  }

  return {
    id: event.id,
    title: event.title,
    body: event.body,
    receivedAt: event.receivedAt,
    data: event.data,
    read: false,
  };
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}
