const WINDOW_BYTES = 16 * 1024 * 1024;
const MAX_WINDOWS_PER_URL = 8;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

type WindowEntry = {
  url: string;
  windowStart: number;
  windowActualEnd: number;
  buffer: ArrayBuffer;
  byteLength: number;
  isFullFile: boolean;
  responseStatus?: number;
  contentRange?: string;
  lastUsed: number;
  prev?: WindowEntry;
  next?: WindowEntry;
};

const windowsByUrl = new Map<string, Map<number, WindowEntry>>();
const inFlight = new Map<string, Promise<WindowEntry>>();
const knownTotalSizes = new Map<string, number>();
let head: WindowEntry | null = null;
let tail: WindowEntry | null = null;
let totalBytes = 0;
let hits = 0;
let misses = 0;
let evictions = 0;

const getWindowKey = (url: string, start: number) => `${url}::${start}`;

const getFullFileEntry = (url: string) => {
  const perUrl = windowsByUrl.get(url);
  if (!perUrl) {
    return null;
  }
  for (const entry of perUrl.values()) {
    if (entry.isFullFile) {
      return entry;
    }
  }
  return null;
};

const touchEntry = (entry: WindowEntry) => {
  entry.lastUsed = Date.now();
  if (head === entry) {
    return;
  }
  if (entry.prev) {
    entry.prev.next = entry.next;
  }
  if (entry.next) {
    entry.next.prev = entry.prev;
  }
  if (tail === entry) {
    tail = entry.prev ?? null;
  }
  entry.prev = undefined;
  entry.next = head ?? undefined;
  if (head) {
    head.prev = entry;
  }
  head = entry;
  if (!tail) {
    tail = entry;
  }
};

const parseContentRange = (value: string | null) => {
  if (!value) {
    return null;
  }
  const match = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(value);
  if (!match) {
    return null;
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === "*" ? null : Number(match[3]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  return {
    start,
    end,
    total: total && Number.isFinite(total) ? total : null,
  };
};

const updateKnownTotalSize = (url: string, total: number | null) => {
  if (!total || !Number.isFinite(total) || total <= 0) {
    return;
  }
  knownTotalSizes.set(url, Math.floor(total));
};

const insertEntry = (entry: WindowEntry) => {
  entry.prev = undefined;
  entry.next = head ?? undefined;
  if (head) {
    head.prev = entry;
  }
  head = entry;
  if (!tail) {
    tail = entry;
  }
};

const removeEntry = (entry: WindowEntry) => {
  const perUrl = windowsByUrl.get(entry.url);
  if (perUrl) {
    perUrl.delete(entry.windowStart);
    if (perUrl.size === 0) {
      windowsByUrl.delete(entry.url);
    }
  }
  totalBytes -= entry.byteLength;
  if (entry.prev) {
    entry.prev.next = entry.next;
  }
  if (entry.next) {
    entry.next.prev = entry.prev;
  }
  if (head === entry) {
    head = entry.next ?? null;
  }
  if (tail === entry) {
    tail = entry.prev ?? null;
  }
  entry.prev = undefined;
  entry.next = undefined;
};

const clearUrl = (url: string) => {
  const perUrl = windowsByUrl.get(url);
  if (!perUrl) {
    return;
  }
  const entries = Array.from(perUrl.values());
  for (const entry of entries) {
    removeEntry(entry);
    evictions += 1;
  }
};

const enforceUrlLimit = (url: string) => {
  const perUrl = windowsByUrl.get(url);
  if (!perUrl) {
    return;
  }
  while (perUrl.size > MAX_WINDOWS_PER_URL) {
    let candidate = tail;
    while (candidate && candidate.url !== url) {
      candidate = candidate.prev ?? null;
    }
    if (!candidate) {
      break;
    }
    removeEntry(candidate);
    evictions += 1;
  }
};

const evictToBudget = () => {
  while (totalBytes > MAX_TOTAL_BYTES && tail) {
    if (head === tail) {
      break;
    }
    const candidate = tail;
    removeEntry(candidate);
    evictions += 1;
  }
};

const storeWindow = (
  url: string,
  windowStart: number,
  buffer: ArrayBuffer,
  options: {
    isFullFile: boolean;
    responseStatus?: number;
    contentRange?: string | null;
  }
) => {
  if (options.isFullFile) {
    clearUrl(url);
  }
  const perUrl = windowsByUrl.get(url) ?? new Map<number, WindowEntry>();
  const windowActualEnd = windowStart + buffer.byteLength - 1;
  const entry: WindowEntry = {
    url,
    windowStart,
    windowActualEnd,
    buffer,
    byteLength: buffer.byteLength,
    isFullFile: options.isFullFile,
    responseStatus: options.responseStatus,
    contentRange: options.contentRange ?? undefined,
    lastUsed: Date.now(),
  };
  perUrl.set(windowStart, entry);
  windowsByUrl.set(url, perUrl);
  totalBytes += buffer.byteLength;
  insertEntry(entry);
  enforceUrlLimit(url);
  evictToBudget();
  return entry;
};

const fetchWindow = async (
  url: string,
  windowStart: number,
  signal?: AbortSignal
) => {
  const windowEnd = windowStart + WINDOW_BYTES - 1;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Range: `bytes=${windowStart}-${windowEnd}`,
      },
      signal,
    });
  } catch (error) {
    console.error("[range] window fetch failed", {
      url,
      windowStart,
      windowEnd,
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  }

  if (!response.ok) {
    const contentRange = response.headers.get("Content-Range");
    console.error("[range] window fetch failed", {
      url,
      windowStart,
      windowEnd,
      status: response.status,
      contentRange,
    });
    throw new Error(`Range fetch failed (${response.status}).`);
  }

  const contentRange = response.headers.get("Content-Range");
  const buffer = await response.arrayBuffer();
  if (response.status === 200) {
    updateKnownTotalSize(url, buffer.byteLength);
    const entry = storeWindow(url, 0, buffer, {
      isFullFile: true,
      responseStatus: response.status,
      contentRange,
    });
    if (import.meta.env.DEV) {
      console.info("[range] fallback full fetch", { url });
    }
    return entry;
  }

  const parsed = parseContentRange(contentRange);
  updateKnownTotalSize(url, parsed?.total ?? null);
  const entry = storeWindow(url, windowStart, buffer, {
    isFullFile: false,
    responseStatus: response.status,
    contentRange,
  });
  if (import.meta.env.DEV) {
    console.info("[range] window fetch", { url, windowStart });
  }
  return entry;
};

const getWindow = async (
  url: string,
  windowStart: number,
  signal?: AbortSignal
) => {
  const fullEntry = getFullFileEntry(url);
  if (fullEntry) {
    hits += 1;
    touchEntry(fullEntry);
    return fullEntry;
  }

  const perUrl = windowsByUrl.get(url);
  const cached = perUrl?.get(windowStart);
  if (cached) {
    hits += 1;
    touchEntry(cached);
    return cached;
  }

  misses += 1;
  const key = getWindowKey(url, windowStart);
  const existing = inFlight.get(key);
  if (existing) {
    return existing;
  }
  const promise = fetchWindow(url, windowStart, signal).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
};

const logRangeFailure = (details: Record<string, unknown>) => {
  console.error("[range] slice failed", details);
};

const getKnownTotalSize = (url: string) =>
  knownTotalSizes.get(url) ?? null;

export const fetchRange = async (
  url: string,
  start: number,
  length: number,
  signal?: AbortSignal
): Promise<ArrayBuffer> => {
  if (start < 0 || length <= 0) {
    throw new Error("Invalid range request.");
  }

  const totalSize = getKnownTotalSize(url);
  if (totalSize !== null && start + length > totalSize) {
    logRangeFailure({
      url,
      start,
      length,
      totalSize,
      reason: "range exceeds known payload size",
    });
    throw new Error("Range slice exceeds payload size.");
  }

  const result = new Uint8Array(length);
  let offset = 0;
  while (offset < length) {
    const rangeStart = start + offset;
    const windowStart = Math.floor(rangeStart / WINDOW_BYTES) * WINDOW_BYTES;
    const windowEntry = await getWindow(url, windowStart, signal);
    const inWindowOffset = rangeStart - windowEntry.windowStart;
    const remaining = length - offset;
    const windowAvailable = windowEntry.buffer.byteLength - inWindowOffset;
    if (inWindowOffset < 0 || windowAvailable <= 0) {
      logRangeFailure({
        url,
        start,
        length,
        windowStart,
        requestedWindowEnd: windowStart + WINDOW_BYTES - 1,
        bufferByteLength: windowEntry.buffer.byteLength,
        windowActualEnd: windowEntry.windowActualEnd,
        responseStatus: windowEntry.responseStatus,
        contentRange: windowEntry.contentRange,
        reason: "window does not cover requested range",
      });
      throw new Error("Range slice exceeds payload size.");
    }
    const available = Math.min(remaining, windowAvailable);
    result.set(
      new Uint8Array(windowEntry.buffer, inWindowOffset, available),
      offset
    );
    offset += available;
  }
  return result.buffer;
};

export const getRangeWindowStats = () => {
  let totalWindows = 0;
  windowsByUrl.forEach((map) => {
    totalWindows += map.size;
  });
  return {
    totalBytes,
    totalWindows,
    hits,
    misses,
    evictions,
  };
};

export { getKnownTotalSize };
