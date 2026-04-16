export const DELIVERY_FEED_BRANCH = 'living-docs-feed';
export const DELIVERY_FEED_DIR = '.living-docs/feed';
export const DELIVERY_FEED_PER_REPO_LIMIT = 20;

export type DeliveryFeedEvent = {
  id: string;
  title: string;
  body: string;
  url?: string;
  status?: string;
  source?: string;
  createdAt: string;
  repo: string;
};

export function deliveryFeedFileName(createdAt: string, id: string): string {
  const stamp = createdAt.replace(/:/g, '-');
  return `${stamp}--${id}.json`;
}
