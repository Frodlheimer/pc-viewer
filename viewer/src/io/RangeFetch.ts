const WINDOW_BYTES = 16 * 1024 * 1024;
const MAX_WINDOWS_PER_URL = 8;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

type WindowEntry = {
  url: string;
  windowStart: number;
  buffer: ArrayBuffer;
  byteLength: number;
  isFullFile: boolean;
  lastUsed: number;
  prev?: WindowEntry;
  next?: WindowEntry;
};

const windowsByUrl = new Map<string, Map<number, WindowEntry>>();
const inFlight = new Map<string, Promise<ArrayBuffer>>();
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
  isFullFile: boolean
) => {
  if (isFullFile) {
    clearUrl(url);
  }
  const perUrl = windowsByUrl.get(url) ?? new Map<number, WindowEntry>();
  const entry: WindowEntry = {
    url,
    windowStart,
    buffer,
    byteLength: buffer.byteLength,
    isFullFile,
    lastUsed: Date.now(),
  };
  perUrl.set(windowStart, entry);
  windowsByUrl.set(url, perUrl);
  totalBytes += buffer.byteLength;
  insertEntry(entry);
  enforceUrlLimit(url);
  evictToBudget();
};

const fetchWindow = async (
  url: string,
  windowStart: number,
  signal?: AbortSignal
) => {
  const windowEnd = windowStart + WINDOW_BYTES - 1;
  const response = await fetch(url, {
    headers: {
      Range: `bytes=${windowStart}-${windowEnd}`,
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Range fetch failed (${response.status}).`);
  }

  const buffer = await response.arrayBuffer();
  if (response.status === 200) {
    storeWindow(url, 0, buffer, true);
    if (import.meta.env.DEV) {
      console.info("[range] fallback full fetch", { url });
    }
    return buffer;
  }

  storeWindow(url, windowStart, buffer, false);
  if (import.meta.env.DEV) {
    console.info("[range] window fetch", { url, windowStart });
  }
  return buffer;
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
    return fullEntry.buffer;
  }

  const perUrl = windowsByUrl.get(url);
  const cached = perUrl?.get(windowStart);
  if (cached) {
    hits += 1;
    touchEntry(cached);
    return cached.buffer;
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

const sliceBuffer = (buffer: ArrayBuffer, start: number, length: number) => {
  if (start < 0 || length <= 0) {
    throw new Error("Invalid range request.");
  }
  if (start + length > buffer.byteLength) {
    throw new Error("Range slice exceeds payload size.");
  }
  return buffer.slice(start, start + length);
};

export const fetchRange = async (
  url: string,
  start: number,
  length: number,
  signal?: AbortSignal
): Promise<ArrayBuffer> => {
  if (start < 0 || length <= 0) {
    throw new Error("Invalid range request.");
  }

  if (length > WINDOW_BYTES) {
    const result = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      const rangeStart = start + offset;
      const windowStart =
        Math.floor(rangeStart / WINDOW_BYTES) * WINDOW_BYTES;
      const windowBuffer = await getWindow(url, windowStart, signal);
      const inWindowOffset = rangeStart - windowStart;
      const remaining = length - offset;
      const available = Math.min(
        remaining,
        windowBuffer.byteLength - inWindowOffset
      );
      if (available <= 0) {
        throw new Error("Range slice exceeds payload size.");
      }
      result.set(
        new Uint8Array(windowBuffer, inWindowOffset, available),
        offset
      );
      offset += available;
    }
    return result.buffer;
  }

  const windowStart = Math.floor(start / WINDOW_BYTES) * WINDOW_BYTES;
  const buffer = await getWindow(url, windowStart, signal);
  return sliceBuffer(buffer, start - windowStart, length);
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
