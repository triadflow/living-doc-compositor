export const DELIVERY_MANIFEST_PATH = '.living-docs/manifest.json';

export type DeliveryManifestDoc = {
  docId: string;
  title: string;
  publicUrl: string;
  trackedPaths: string[];
};
