import { performance } from "node:perf_hooks";
import { fetchRangeView } from "../src/io/RangeFetch.js";
import { loadPage } from "../src/io/HierarchyPagingLoader.js";

const buildPch1Page = (pageBytes) => {
  const buffer = new ArrayBuffer(pageBytes);
  const view = new DataView(buffer);
  view.setUint8(0, "P".charCodeAt(0));
  view.setUint8(1, "C".charCodeAt(0));
  view.setUint8(2, "H".charCodeAt(0));
  view.setUint8(3, "1".charCodeAt(0));
  view.setUint16(4, 1, true);
  view.setUint16(6, pageBytes, true);
  view.setUint32(8, 0, true);
  view.setUint32(12, 0, true);
  view.setUint32(16, 0, true);
  return buffer;
};

const buildRangeResponse = (buffer) =>
  new Response(buffer, {
    status: 206,
    headers: {
      "Content-Range": `bytes 0-${buffer.byteLength - 1}/${buffer.byteLength}`,
    },
  });

const setupFetchMock = (buffer) => {
  globalThis.fetch = async () => buildRangeResponse(buffer);
};

const benchRangeView = async () => {
  const payload = new Uint8Array(1024 * 1024);
  payload.fill(7);
  setupFetchMock(payload);
  const start = performance.now();
  for (let i = 0; i < 200; i += 1) {
    const view = await fetchRangeView(
      `https://bench.invalid/range-${i % 4}`,
      64,
      256
    );
    if (view.byteLength !== 256) {
      throw new Error("range view mismatch");
    }
  }
  const duration = performance.now() - start;
  console.log(`[bench] fetchRangeView (single-window) x200: ${duration.toFixed(2)} ms`);
};

const benchHierarchy = async () => {
  const buffer = buildPch1Page(64 * 1024);
  setupFetchMock(buffer);
  const start = performance.now();
  for (let i = 0; i < 100; i += 1) {
    await loadPage(`https://bench.invalid/hierarchy-${i}`, 0);
  }
  const duration = performance.now() - start;
  console.log(`[bench] loadPage x100: ${duration.toFixed(2)} ms`);
};

const benchMaskUpdate = () => {
  const pointCount = 2_000_000;
  const mask = new Uint8Array(pointCount);
  mask.fill(1);
  const start = performance.now();
  for (let i = 0; i < 5000; i += 1) {
    const index = (i * 7919) % pointCount;
    mask[index] = 0;
  }
  const duration = performance.now() - start;
  console.log(`[bench] mask in-place updates x5000: ${duration.toFixed(2)} ms`);
};

await benchRangeView();
await benchHierarchy();
benchMaskUpdate();
