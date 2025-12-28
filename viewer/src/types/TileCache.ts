import type { TileFormat } from "./Dataset";
import type { Pct2Directory, TypedArray } from "./Pct2";
import type { TileRenderData } from "./Tile";

export type TileSource = {
  format: TileFormat;
  url?: string;
  containerUrl?: string;
  byteOffset?: number;
  byteLength?: number;
};

export type CachedTileEntry = {
  key: string;
  renderData: TileRenderData;
  directory?: Pct2Directory;
  rawBuffer?: ArrayBuffer | Uint8Array;
  decodedOptional: Map<string, TypedArray>;
  source: TileSource;
  lastOptionalAccess?: number;
};
