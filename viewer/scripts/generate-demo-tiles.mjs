import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const datasetDir = path.join(rootDir, "public", "datasets", "demo");
const tilesDir = path.join(datasetDir, "tiles");

const tileId = "0_0_0";
const pointCount = 50_000;

const positions = new Float32Array(pointCount * 3);
const colors = new Uint8Array(pointCount * 3);

let minX = Infinity;
let minY = Infinity;
let minZ = Infinity;
let maxX = -Infinity;
let maxY = -Infinity;
let maxZ = -Infinity;

for (let i = 0; i < pointCount; i += 1) {
  const t = i / pointCount;
  const angle = t * Math.PI * 28;
  const radius = 55 + Math.sin(t * 10) * 8;
  const jitter = (Math.random() - 0.5) * 2.2;

  const x = Math.cos(angle) * radius + jitter;
  const y = Math.sin(angle) * radius + jitter;
  const z = (t - 0.5) * 90 + (Math.random() - 0.5) * 2;

  const offset = i * 3;
  positions[offset] = x;
  positions[offset + 1] = y;
  positions[offset + 2] = z;

  minX = Math.min(minX, x);
  minY = Math.min(minY, y);
  minZ = Math.min(minZ, z);
  maxX = Math.max(maxX, x);
  maxY = Math.max(maxY, y);
  maxZ = Math.max(maxZ, z);

  const r = Math.round(140 + 90 * Math.sin(t * Math.PI));
  const g = Math.round(80 + 170 * t);
  const b = Math.round(220 - 140 * t);

  colors[offset] = Math.max(0, Math.min(255, r));
  colors[offset + 1] = Math.max(0, Math.min(255, g));
  colors[offset + 2] = Math.max(0, Math.min(255, b));
}

const bounds = [minX, minY, minZ, maxX, maxY, maxZ];

const headerSize = 16;
const buffer = new ArrayBuffer(
  headerSize + positions.byteLength + colors.byteLength
);
const view = new DataView(buffer);
view.setUint8(0, "P".charCodeAt(0));
view.setUint8(1, "C".charCodeAt(0));
view.setUint8(2, "T".charCodeAt(0));
view.setUint8(3, "1".charCodeAt(0));
view.setUint32(4, 1, true);
view.setUint32(8, pointCount, true);
view.setUint32(12, 1, true);

new Float32Array(buffer, headerSize, positions.length).set(positions);
new Uint8Array(buffer, headerSize + positions.byteLength, colors.length).set(
  colors
);

await mkdir(tilesDir, { recursive: true });
await writeFile(path.join(tilesDir, `${tileId}.pct`), Buffer.from(buffer));

const manifest = {
  schemaVersion: 0.2,
  id: "demo",
  name: "Demo Dataset",
  crs: {},
  units: "meters",
  attributes: [
    { name: "position", type: "float32", components: 3, role: "position" },
    { name: "rgb", type: "uint8", components: 3, role: "color" },
  ],
  roles: { position: "position", color: "rgb" },
  boundsQuantization: { origin: [0, 0, 0], scale: [1, 1, 1] },
  levels: [
    {
      id: "L0",
      tiles: [
        {
          id: tileId,
          url: `/datasets/demo/tiles/${tileId}.pct`,
          bounds,
          pointCount,
        },
      ],
    },
  ],
  bounds,
};

await writeFile(
  path.join(datasetDir, "manifest.json"),
  JSON.stringify(manifest, null, 2)
);

console.log(
  `Generated demo tile ${tileId} with ${pointCount.toLocaleString()} points.`
);
