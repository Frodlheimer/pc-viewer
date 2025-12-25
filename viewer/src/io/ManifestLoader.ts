import type { DatasetManifest } from "../types/Dataset";

export const loadManifest = async (url: string): Promise<DatasetManifest> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Manifest load failed (${response.status})`);
  }
  const json = (await response.json()) as unknown;
  if (!json || typeof json !== "object") {
    throw new Error("Manifest format invalid.");
  }
  return json as DatasetManifest;
};
