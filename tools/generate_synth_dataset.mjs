import { createWriteStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewerRoot = path.resolve(__dirname, "..", "viewer");
const datasetsRoot = path.join(viewerRoot, "public", "datasets");

const DEFAULT_POINTS = 5_000_000;
const DEFAULT_TILE_CAP = 150_000;
const DEFAULT_LOD = 2;

const parseArgs = () => {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i += 1) {
    const raw = process.argv[i];
    if (!raw.startsWith("--")) {
      continue;
    }
    const key = raw.slice(2);
    const next = process.argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(key, next);
      i += 1;
    } else {
      args.set(key, "true");
    }
  }
  return args;
};

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const align = (value, alignment) =>
  Math.ceil(value / alignment) * alignment;

const makeTimestamp = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    "_",
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join("");
};

const args = parseArgs();
const datasetIdOverride = args.get("id");
const pointCount = Math.max(
  1,
  Math.floor(toNumber(args.get("points"), DEFAULT_POINTS))
);
const tileCap = Math.max(
  1,
  Math.floor(toNumber(args.get("tileCap"), DEFAULT_TILE_CAP))
);
const rootPointsOverride = args.has("rootPoints")
  ? Math.max(0, Math.floor(toNumber(args.get("rootPoints"), 0)))
  : null;
let lod = Math.floor(toNumber(args.get("lod"), DEFAULT_LOD));
if (lod < 1) {
  lod = 1;
}
if (lod > 2) {
  console.warn("LOD > 2 not supported yet; using 2.");
  lod = 2;
}
const includeColor = !args.has("no-color");

const datasetId = datasetIdOverride ?? `synth_${makeTimestamp()}`;
const datasetName = args.get("name") ?? `Synth Dataset ${datasetId}`;
const updateLatest = args.has("update-latest") || datasetIdOverride === undefined;
const overwrite = args.has("overwrite");
const datasetDir = path.join(datasetsRoot, datasetId);
const latestDir = path.join(datasetsRoot, "synth_latest");

const ensureCleanDir = async (dir) => {
  const exists = await stat(dir)
    .then(() => true)
    .catch((error) => {
      if (error && typeof error === "object" && "code" in error) {
        if (error.code === "ENOENT") {
          return false;
        }
      }
      throw error;
    });
  if (exists) {
    if (!overwrite) {
      throw new Error(
        `Dataset directory already exists (${dir}). Use --overwrite to replace it.`
      );
    }
    await rm(dir, { recursive: true, force: true });
  }
  await mkdir(dir, { recursive: true });
};

await ensureCleanDir(datasetDir);
if (updateLatest) {
  await mkdir(latestDir, { recursive: true });
}

const boundsMin = [-100, -100, -100];
const boundsMax = [100, 100, 100];
const quantizationOrigin = boundsMin;
const quantizationScale = [0.001, 0.001, 0.001];

let seed = 1337;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0xffffffff;
};

const quantize = (value, origin, scale) =>
  Math.round((value - origin) / scale);

const createPct2Buffer = ({
  nodeId,
  pointCount,
  positionsInt32,
  colors,
}) => {
  const encoder = new TextEncoder();
  const attributes = [
    {
      name: "position",
      type: 5,
      components: 3,
      normalized: 0,
      data: positionsInt32,
    },
  ];
  if (includeColor && colors) {
    attributes.push({
      name: "rgb",
      type: 2,
      components: 3,
      normalized: 1,
      data: colors,
    });
  }

  const entries = attributes.map((attr) => {
    const nameBytes = encoder.encode(attr.name);
    const entryBytes = 17 + nameBytes.length;
    return { ...attr, nameBytes, entryBytes };
  });

  const rawHeaderBytes =
    76 + entries.reduce((sum, entry) => sum + entry.entryBytes, 0);
  const headerBytes = align(rawHeaderBytes, 4);

  let payloadOffset = 0;
  const payloadLayout = entries.map((entry) => {
    const byteOffset = payloadOffset;
    payloadOffset += entry.data.byteLength;
    return { ...entry, byteOffset, byteLength: entry.data.byteLength };
  });

  const buffer = new ArrayBuffer(headerBytes + payloadOffset);
  const view = new DataView(buffer);
  view.setUint8(0, "P".charCodeAt(0));
  view.setUint8(1, "C".charCodeAt(0));
  view.setUint8(2, "T".charCodeAt(0));
  view.setUint8(3, "2".charCodeAt(0));
  view.setUint16(4, 1, true);
  view.setUint16(6, headerBytes, true);
  view.setBigUint64(8, BigInt(nodeId), true);
  view.setUint32(16, pointCount, true);
  view.setUint32(20, 0, true);
  view.setFloat64(24, quantizationOrigin[0], true);
  view.setFloat64(32, quantizationOrigin[1], true);
  view.setFloat64(40, quantizationOrigin[2], true);
  view.setFloat64(48, quantizationScale[0], true);
  view.setFloat64(56, quantizationScale[1], true);
  view.setFloat64(64, quantizationScale[2], true);
  view.setUint16(72, payloadLayout.length, true);
  view.setUint16(74, 0, true);

  let cursor = 76;
  payloadLayout.forEach((entry) => {
    view.setUint8(cursor, entry.nameBytes.length);
    cursor += 1;
    new Uint8Array(buffer, cursor, entry.nameBytes.length).set(entry.nameBytes);
    cursor += entry.nameBytes.length;
    view.setUint8(cursor, entry.type);
    cursor += 1;
    view.setUint8(cursor, entry.components);
    cursor += 1;
    view.setUint8(cursor, 0);
    cursor += 1;
    view.setUint8(cursor, entry.normalized);
    cursor += 1;
    view.setUint32(cursor, entry.byteOffset, true);
    cursor += 4;
    view.setUint32(cursor, entry.byteLength, true);
    cursor += 4;
    view.setUint32(cursor, 0, true);
    cursor += 4;
  });

  const payloadStart = headerBytes;
  payloadLayout.forEach((entry) => {
    const targetOffset = payloadStart + entry.byteOffset;
    if (entry.data instanceof Int32Array) {
      new Int32Array(buffer, targetOffset, entry.data.length).set(entry.data);
    } else if (entry.data instanceof Uint8Array) {
      new Uint8Array(buffer, targetOffset, entry.data.length).set(entry.data);
    }
  });

  return buffer;
};

const generateTile = ({
  nodeId,
  parentId,
  level,
  childMask,
  count,
  regionMin,
  regionMax,
}) => {
  const positionsInt32 = new Int32Array(count * 3);
  const colors = includeColor ? new Uint8Array(count * 3) : null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  const spanX = regionMax[0] - regionMin[0];
  const spanY = regionMax[1] - regionMin[1];
  const spanZ = regionMax[2] - regionMin[2];

  for (let i = 0; i < count; i += 1) {
    const x = regionMin[0] + rand() * spanX;
    const y = regionMin[1] + rand() * spanY;
    const z = regionMin[2] + rand() * spanZ;
    const offset = i * 3;

    positionsInt32[offset] = quantize(
      x,
      quantizationOrigin[0],
      quantizationScale[0]
    );
    positionsInt32[offset + 1] = quantize(
      y,
      quantizationOrigin[1],
      quantizationScale[1]
    );
    positionsInt32[offset + 2] = quantize(
      z,
      quantizationOrigin[2],
      quantizationScale[2]
    );

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);

    if (colors) {
      const nx = spanX === 0 ? 0.5 : (x - regionMin[0]) / spanX;
      const ny = spanY === 0 ? 0.5 : (y - regionMin[1]) / spanY;
      const nz = spanZ === 0 ? 0.5 : (z - regionMin[2]) / spanZ;
      colors[offset] = Math.round(50 + 205 * nx);
      colors[offset + 1] = Math.round(50 + 205 * ny);
      colors[offset + 2] = Math.round(50 + 205 * nz);
    }
  }

  const bounds = [minX, minY, minZ, maxX, maxY, maxZ];
  const quantizedBounds = {
    min: [
      quantize(minX, quantizationOrigin[0], quantizationScale[0]),
      quantize(minY, quantizationOrigin[1], quantizationScale[1]),
      quantize(minZ, quantizationOrigin[2], quantizationScale[2]),
    ],
    max: [
      quantize(maxX, quantizationOrigin[0], quantizationScale[0]),
      quantize(maxY, quantizationOrigin[1], quantizationScale[1]),
      quantize(maxZ, quantizationOrigin[2], quantizationScale[2]),
    ],
  };

  const buffer = createPct2Buffer({
    nodeId,
    pointCount: count,
    positionsInt32,
    colors,
  });

  return {
    nodeId,
    parentId,
    level,
    childMask,
    pointCount: count,
    bounds,
    quantizedBounds,
    buffer,
  };
};

let remainingPoints = pointCount;
const nodes = [];
const tileManifests = [];
const leafManifests = [];
let globalMin = [Infinity, Infinity, Infinity];
let globalMax = [-Infinity, -Infinity, -Infinity];
let byteOffset = 0;
let nodeIdCounter = 1;

const containerPath = path.join(datasetDir, "tiles.pctc");
const containerStream = createWriteStream(containerPath);
const writeToStream = async (stream, chunk) => {
  if (!stream.write(chunk)) {
    await once(stream, "drain");
  }
};

const leafTileCount = Math.max(1, Math.ceil(pointCount / tileCap));
const grid = Math.ceil(Math.cbrt(leafTileCount));
const cellSize = [
  (boundsMax[0] - boundsMin[0]) / grid,
  (boundsMax[1] - boundsMin[1]) / grid,
  (boundsMax[2] - boundsMin[2]) / grid,
];

let rootNodeId = null;
if (lod >= 2) {
  const defaultRootPoints = Math.max(5_000, Math.floor(pointCount / 50));
  const rootPoints =
    rootPointsOverride !== null
      ? Math.min(pointCount - 1, rootPointsOverride)
      : Math.min(tileCap, defaultRootPoints);
  remainingPoints = Math.max(1, pointCount - rootPoints);
  const rootTile = generateTile({
    nodeId: nodeIdCounter,
    parentId: 0,
    level: 0,
    childMask: 1,
    count: rootPoints,
    regionMin: boundsMin,
    regionMax: boundsMax,
  });
  rootNodeId = nodeIdCounter;
  nodeIdCounter += 1;
  await writeToStream(containerStream, Buffer.from(rootTile.buffer));
  nodes.push({
    ...rootTile,
    byteOffset,
    byteLength: rootTile.buffer.byteLength,
  });
  byteOffset += rootTile.buffer.byteLength;

  tileManifests.push({
    id: `node-${rootTile.nodeId}`,
    nodeId: rootTile.nodeId,
    bounds: rootTile.bounds,
    pointCount: rootTile.pointCount,
    format: "pct2",
    containerUrl: `/datasets/${datasetId}/tiles.pctc`,
    byteOffset: nodes[nodes.length - 1].byteOffset,
    byteLength: nodes[nodes.length - 1].byteLength,
  });
}

const leafCount = Math.max(1, Math.ceil(remainingPoints / tileCap));
let remainingLeafPoints = remainingPoints;

for (let i = 0; i < leafCount; i += 1) {
  const count =
    i === leafCount - 1
      ? remainingLeafPoints
      : Math.min(tileCap, remainingLeafPoints);
  remainingLeafPoints = Math.max(0, remainingLeafPoints - count);

  const gx = i % grid;
  const gy = Math.floor(i / grid) % grid;
  const gz = Math.floor(i / (grid * grid));
  const regionMin = [
    boundsMin[0] + gx * cellSize[0],
    boundsMin[1] + gy * cellSize[1],
    boundsMin[2] + gz * cellSize[2],
  ];
  const regionMax = [
    regionMin[0] + cellSize[0],
    regionMin[1] + cellSize[1],
    regionMin[2] + cellSize[2],
  ];

  const tile = generateTile({
    nodeId: nodeIdCounter,
    parentId: rootNodeId ?? 0,
    level: rootNodeId ? 1 : 0,
    childMask: 0,
    count,
    regionMin,
    regionMax,
  });
  nodeIdCounter += 1;

  await writeToStream(containerStream, Buffer.from(tile.buffer));
  const entry = {
    ...tile,
    byteOffset,
    byteLength: tile.buffer.byteLength,
  };
  nodes.push(entry);
  byteOffset += tile.buffer.byteLength;

  tileManifests.push({
    id: `node-${tile.nodeId}`,
    nodeId: tile.nodeId,
    bounds: tile.bounds,
    pointCount: tile.pointCount,
    format: "pct2",
    containerUrl: `/datasets/${datasetId}/tiles.pctc`,
    byteOffset: entry.byteOffset,
    byteLength: entry.byteLength,
  });
  leafManifests.push(tileManifests[tileManifests.length - 1]);

  globalMin = [
    Math.min(globalMin[0], tile.bounds[0]),
    Math.min(globalMin[1], tile.bounds[1]),
    Math.min(globalMin[2], tile.bounds[2]),
  ];
  globalMax = [
    Math.max(globalMax[0], tile.bounds[3]),
    Math.max(globalMax[1], tile.bounds[4]),
    Math.max(globalMax[2], tile.bounds[5]),
  ];

  if (i % 10 === 0 || i === leafCount - 1) {
    const done = Math.min(pointCount, pointCount - remainingLeafPoints);
    const pct = Math.round((done / pointCount) * 1000) / 10;
    console.log(`Generated tiles: ${i + 1}/${leafCount} (${pct}%)`);
  }
}

containerStream.end();
await finished(containerStream);

const pageBytes = 64 * 1024;
const encodedPageBytes = pageBytes === 65536 ? 0 : pageBytes;
const maxRecordsPerPage = Math.floor((pageBytes - 20) / 80);
const hierarchyPageCount = Math.max(
  1,
  Math.ceil(nodes.length / maxRecordsPerPage)
);
const hierarchyPath = path.join(datasetDir, "hierarchy.pch");
const hierarchyStream = createWriteStream(hierarchyPath);

for (let pageIndex = 0; pageIndex < hierarchyPageCount; pageIndex += 1) {
  const startIndex = pageIndex * maxRecordsPerPage;
  const endIndex = Math.min(nodes.length, startIndex + maxRecordsPerPage);
  const pageRecords = nodes.slice(startIndex, endIndex);

  const hierarchyBuffer = new ArrayBuffer(pageBytes);
  const hierarchyView = new DataView(hierarchyBuffer);
  hierarchyView.setUint8(0, "P".charCodeAt(0));
  hierarchyView.setUint8(1, "C".charCodeAt(0));
  hierarchyView.setUint8(2, "H".charCodeAt(0));
  hierarchyView.setUint8(3, "1".charCodeAt(0));
  hierarchyView.setUint16(4, 1, true);
  hierarchyView.setUint16(6, encodedPageBytes, true);
  hierarchyView.setUint32(8, pageIndex, true);
  hierarchyView.setUint32(12, pageRecords.length, true);
  hierarchyView.setUint32(16, 0, true);

  pageRecords.forEach((node, index) => {
    const offset = 20 + index * 80;
    hierarchyView.setBigUint64(offset, BigInt(node.nodeId), true);
    hierarchyView.setBigUint64(offset + 8, BigInt(node.parentId), true);
    hierarchyView.setUint8(offset + 16, node.level);
    hierarchyView.setUint8(offset + 17, node.childMask);
    hierarchyView.setUint16(offset + 18, 0, true);
    hierarchyView.setUint32(offset + 20, node.pointCount, true);
    hierarchyView.setInt32(offset + 24, node.quantizedBounds.min[0], true);
    hierarchyView.setInt32(offset + 28, node.quantizedBounds.min[1], true);
    hierarchyView.setInt32(offset + 32, node.quantizedBounds.min[2], true);
    hierarchyView.setInt32(offset + 36, node.quantizedBounds.max[0], true);
    hierarchyView.setInt32(offset + 40, node.quantizedBounds.max[1], true);
    hierarchyView.setInt32(offset + 44, node.quantizedBounds.max[2], true);
    hierarchyView.setUint16(offset + 48, 0, true);
    hierarchyView.setUint16(offset + 50, 0, true);
    hierarchyView.setBigUint64(offset + 52, BigInt(node.byteOffset), true);
    hierarchyView.setUint32(offset + 60, node.byteLength, true);
    hierarchyView.setUint32(offset + 64, 0, true);
    hierarchyView.setBigUint64(offset + 68, 0n, true);
    hierarchyView.setUint32(offset + 76, 0, true);
  });

  await writeToStream(hierarchyStream, Buffer.from(hierarchyBuffer));
}

hierarchyStream.end();
await finished(hierarchyStream);

const manifest = {
  schemaVersion: 0.2,
  id: datasetId,
  name: datasetName,
  crs: {},
  units: "meters",
  attributes: [
    { name: "position", type: "float32", components: 3, role: "position" },
    ...(includeColor
      ? [{ name: "rgb", type: "uint8", components: 3, role: "color" }]
      : []),
  ],
  roles: includeColor ? { position: "position", color: "rgb" } : { position: "position" },
  boundsQuantization: {
    origin: quantizationOrigin,
    scale: quantizationScale,
  },
  hierarchyUrl: `/datasets/${datasetId}/hierarchy.pch`,
  hierarchyPageBytes: pageBytes,
  containers: [{ url: `/datasets/${datasetId}/tiles.pctc` }],
  levels: [
    {
      id: "L0",
      tiles: leafManifests,
    },
  ],
  bounds: [
    globalMin[0],
    globalMin[1],
    globalMin[2],
    globalMax[0],
    globalMax[1],
    globalMax[2],
  ],
};

if (lod >= 2 && tileManifests.length > leafManifests.length) {
  manifest.levels.push({
    id: "L1",
    tiles: tileManifests.filter((tile) => tile.nodeId === rootNodeId),
  });
}

await writeFile(
  path.join(datasetDir, "dataset.json"),
  JSON.stringify(manifest, null, 2)
);
if (updateLatest) {
  await writeFile(
    path.join(latestDir, "dataset.json"),
    JSON.stringify(manifest, null, 2)
  );
}

console.log(
  `Generated ${datasetId} with ${pointCount.toLocaleString()} points in ${leafCount} tile(s).`
);
console.log(`Manifest: /datasets/${datasetId}/dataset.json`);
