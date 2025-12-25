import type { Bounds } from "./Tile";

export type TileManifest = {
  id: string;
  url: string;
  bounds: Bounds;
  pointCount: number;
};

export type LevelManifest = {
  id: string;
  tiles: TileManifest[];
};

export type DatasetManifest = {
  id: string;
  name: string;
  levels: LevelManifest[];
  bounds: Bounds;
};

export type DatasetOption = {
  id: string;
  name: string;
  manifestUrl: string;
};

export const DATASETS: DatasetOption[] = [
  {
    id: "demo",
    name: "Demo Dataset",
    manifestUrl: "/datasets/demo/manifest.json",
  },
];

export const getDatasetById = (id: string) =>
  DATASETS.find((dataset) => dataset.id === id) ?? null;
