import { fetchRangeView, getKnownTotalSize } from "./RangeFetch";
import type { NodeRecord, Page } from "../types/Hierarchy";

const PAGE_HEADER_BYTES = 20;
const NODE_RECORD_BYTES = 80;
const DEFAULT_PAGE_BYTES = 64 * 1024;
const DEFAULT_MAX_PAGES = 8;

const pageCache = new Map<string, Page>();
const pageBytesByUrl = new Map<string, number>();
let maxCachedPages = DEFAULT_MAX_PAGES;

const toNodeId = (value: bigint): bigint | number =>
  value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;

const toSafeNumber = (value: bigint, label: string): number => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Hierarchy ${label} exceeds MAX_SAFE_INTEGER.`);
  }
  return Number(value);
};

const getCacheKey = (url: string, pageIndex: number) =>
  `${url}::${pageIndex}`;

const touchCache = (key: string, page: Page) => {
  pageCache.delete(key);
  pageCache.set(key, page);
  while (pageCache.size > maxCachedPages) {
    const oldestKey = pageCache.keys().next().value;
    if (oldestKey) {
      pageCache.delete(oldestKey);
    }
  }
};

type BufferSource = ArrayBuffer | Uint8Array;

const toDataView = (buffer: BufferSource) =>
  buffer instanceof Uint8Array
    ? new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new DataView(buffer);

const parseHeader = (buffer: BufferSource) => {
  if (buffer.byteLength < PAGE_HEADER_BYTES) {
    throw new Error("Hierarchy page header truncated.");
  }
  const view = toDataView(buffer);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  if (magic !== "PCH1") {
    throw new Error(`Hierarchy magic mismatch (${magic}).`);
  }
  const version = view.getUint16(4, true);
  if (version !== 1) {
    throw new Error(`Unsupported hierarchy version ${version}.`);
  }
  const pageBytesRaw = view.getUint16(6, true);
  const pageBytes = pageBytesRaw === 0 ? DEFAULT_PAGE_BYTES : pageBytesRaw;
  const pageIndex = view.getUint32(8, true);
  const recordCount = view.getUint32(12, true);
  const reserved = view.getUint32(16, true);
  if (reserved !== 0) {
    throw new Error("Hierarchy header reserved field must be 0.");
  }
  if (pageBytes < PAGE_HEADER_BYTES) {
    throw new Error("Hierarchy pageBytes too small.");
  }
  if (PAGE_HEADER_BYTES + recordCount * NODE_RECORD_BYTES > pageBytes) {
    throw new Error("Hierarchy recordCount exceeds page size.");
  }
  return { pageBytes, pageIndex, recordCount };
};

const parseRecords = (
  buffer: BufferSource,
  recordCount: number
): NodeRecord[] => {
  const requiredBytes = PAGE_HEADER_BYTES + recordCount * NODE_RECORD_BYTES;
  if (buffer.byteLength < requiredBytes) {
    throw new Error("Hierarchy page truncated.");
  }

  const view = toDataView(buffer);
  const records: NodeRecord[] = [];
  let offset = PAGE_HEADER_BYTES;

  for (let i = 0; i < recordCount; i += 1) {
    const nodeId = toNodeId(view.getBigUint64(offset, true));
    const parentId = toNodeId(view.getBigUint64(offset + 8, true));
    const level = view.getUint8(offset + 16);
    const childMask = view.getUint8(offset + 17);
    const pointCount = view.getUint32(offset + 20, true);
    const bmin: [number, number, number] = [
      view.getInt32(offset + 24, true),
      view.getInt32(offset + 28, true),
      view.getInt32(offset + 32, true),
    ];
    const bmax: [number, number, number] = [
      view.getInt32(offset + 36, true),
      view.getInt32(offset + 40, true),
      view.getInt32(offset + 44, true),
    ];
    const containerIndex = view.getUint16(offset + 48, true);
    const byteOffset = toSafeNumber(
      view.getBigUint64(offset + 52, true),
      "byteOffset"
    );
    const byteLength = view.getUint32(offset + 60, true);
    const statsOffset = toSafeNumber(
      view.getBigUint64(offset + 68, true),
      "statsOffset"
    );
    const statsLength = view.getUint32(offset + 76, true);

    records.push({
      nodeId,
      parentId,
      level,
      childMask,
      pointCount,
      bounds: { min: bmin, max: bmax },
      containerIndex,
      byteOffset,
      byteLength,
      statsOffset,
      statsLength,
    });

    offset += NODE_RECORD_BYTES;
  }

  return records;
};

const resolvePageBytes = async (url: string, pageBytes?: number) => {
  if (pageBytes && pageBytes > 0) {
    pageBytesByUrl.set(url, pageBytes);
    return pageBytes;
  }

  const cached = pageBytesByUrl.get(url);
  if (cached) {
    return cached;
  }

  const headerBuffer = await fetchRangeView(url, 0, PAGE_HEADER_BYTES, undefined, {
    allowFullFileFallback: false,
  });
  const header = parseHeader(headerBuffer);
  pageBytesByUrl.set(url, header.pageBytes);
  return header.pageBytes;
};

export type LoadPageOptions = {
  maxPages?: number;
  pageBytes?: number;
};

export const loadPage = async (
  url: string,
  pageIndex: number,
  options?: LoadPageOptions
): Promise<Page> => {
  if (pageIndex < 0) {
    throw new Error("Hierarchy pageIndex must be >= 0.");
  }

  if (options?.maxPages !== undefined) {
    maxCachedPages = Math.max(1, options.maxPages);
  }

  const cacheKey = getCacheKey(url, pageIndex);
  const cached = pageCache.get(cacheKey);
  if (cached) {
    touchCache(cacheKey, cached);
    return cached;
  }

  const pageBytes = await resolvePageBytes(url, options?.pageBytes);
  const start = pageIndex * pageBytes;
  const buffer = await fetchRangeView(url, start, pageBytes, undefined, {
    allowFullFileFallback: false,
  });
  const header = parseHeader(buffer);

  if (header.pageIndex !== pageIndex) {
    throw new Error("Hierarchy page index mismatch.");
  }

  const records = parseRecords(buffer, header.recordCount);
  const page: Page = {
    pageIndex,
    pageBytes: header.pageBytes,
    recordCount: header.recordCount,
    records,
  };

  if (import.meta.env.DEV) {
    console.info("[hierarchy] page loaded", {
      url,
      pageIndex: page.pageIndex,
      recordCount: page.recordCount,
    });
  }

  touchCache(cacheKey, page);
  return page;
};

export type LoadAllPagesResult = {
  pageBytes: number;
  pages: Page[];
  records: NodeRecord[];
};

const isRangeEofError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.message.includes("Range slice exceeds") ||
    error.message.includes("Range fetch failed (416)")
  );
};

export const loadAllPages = async (
  url: string,
  options?: { pageBytes?: number; maxPages?: number }
): Promise<LoadAllPagesResult> => {
  const first = await loadPage(url, 0, { pageBytes: options?.pageBytes });

  const pageBytes = first.pageBytes;
  const totalSize = getKnownTotalSize(url);
  const pageCountFromSize =
    totalSize !== null ? Math.ceil(totalSize / pageBytes) : null;

  const hardMax = options?.maxPages ?? 4096;
  const targetPages =
    pageCountFromSize !== null ? Math.min(pageCountFromSize, hardMax) : hardMax;

  const pages: Page[] = [first];

  for (let i = 1; i < targetPages; i += 1) {
    try {
      const page = await loadPage(url, i, { pageBytes });
      if (page.recordCount === 0) {
        break;
      }
      pages.push(page);
    } catch (error) {
      if (isRangeEofError(error)) {
        break;
      }
      throw error;
    }
  }

  return {
    pageBytes,
    pages,
    records: pages.flatMap((page) => page.records),
  };
};
