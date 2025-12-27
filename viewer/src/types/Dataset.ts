import type { Vec3 } from "./Point";
import type { Bounds } from "./Tile";

export type TileFormat = "pct1" | "pct2";

export type DatasetCrs = {
  epsg?: number;
  wkt?: string;
};

export type AttributeRole =
  | "position"
  | "color"
  | "intensity"
  | "classification"
  | "custom";

export type DatasetAttribute = {
  name: string;
  type: string;
  components: number;
  role?: AttributeRole;
};

export type DatasetRoles = {
  position: string;
  color?: string;
};

export type BoundsQuantization = {
  origin: Vec3;
  scale: Vec3;
};

export type TileContainer = {
  id?: string;
  url: string;
};

export type TileUrlRef = {
  url: string;
  containerUrl?: never;
  byteOffset?: never;
  byteLength?: never;
};

export type TileContainerRef = {
  url?: never;
  containerUrl: string;
  byteOffset: number;
  byteLength: number;
};

export type TileRef = TileUrlRef | TileContainerRef;

export type TileManifest = {
  id: string;
  nodeId?: bigint | number;
  bounds: Bounds;
  pointCount: number;
  format?: TileFormat;
} & TileRef;

export type LevelManifest = {
  id: string;
  tiles: TileManifest[];
};

export type DatasetManifest = {
  schemaVersion: number;
  id: string;
  name: string;
  crs: DatasetCrs;
  units: string;
  attributes: DatasetAttribute[];
  roles: DatasetRoles;
  boundsQuantization: BoundsQuantization;
  hierarchyUrl?: string;
  hierarchyPageBytes?: number;
  containers?: TileContainer[];
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
  {
    id: "synth_latest",
    name: "Synth (latest)",
    manifestUrl: "/datasets/synth_latest/dataset.json",
  },
  {
    id: "test5m",
    name: "Test 5M Dataset",
    manifestUrl: "/datasets/test5m/manifest.json",
  },
];

export const getDatasetById = (id: string) =>
  DATASETS.find((dataset) => dataset.id === id) ?? null;
