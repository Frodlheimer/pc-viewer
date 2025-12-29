import type { NodeRecord, Page } from "../types/Hierarchy";
import { getKnownTotalSize } from "./RangeFetch";
import { loadPage, type LoadPageOptions } from "./HierarchyPagingLoader";

export type HierarchyPagerSnapshot = {
  url: string;
  pageBytes: number;
  pagesLoaded: number;
  recordCount: number;
  eof: boolean;
  inFlight: number;
};

export type HierarchyPagerUpdate = HierarchyPagerSnapshot & {
  pages: Page[];
  records: NodeRecord[];
};

export type HierarchyPager = {
  init: () => Promise<HierarchyPagerUpdate>;
  loadNextPages: (pageCount?: number) => Promise<HierarchyPagerUpdate>;
  snapshot: () => HierarchyPagerSnapshot;
};

type CreateHierarchyPagerOptions = {
  url: string;
  pageBytes?: number;
  signal?: AbortSignal;
  maxPages?: number;
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

export const createHierarchyPager = (
  options: CreateHierarchyPagerOptions
): HierarchyPager => {
  const pages: Page[] = [];
  const records: NodeRecord[] = [];
  const inFlight = new Map<number, Promise<Page | null>>();
  let pageBytes = 0;
  let nextPageIndex = 0;
  let eof = false;

  const snapshot = (): HierarchyPagerSnapshot => ({
    url: options.url,
    pageBytes,
    pagesLoaded: pages.length,
    recordCount: records.length,
    eof,
    inFlight: inFlight.size,
  });

  const loadOne = (pageIndex: number): Promise<Page | null> => {
    if (eof) {
      return Promise.resolve(null);
    }
    const existing = inFlight.get(pageIndex);
    if (existing) {
      return existing;
    }

    const loadOptions: LoadPageOptions = {
      pageBytes: pageBytes || options.pageBytes,
      maxPages: options.maxPages,
      signal: options.signal,
    };

    const promise = loadPage(options.url, pageIndex, loadOptions)
      .then((page) => {
        if (pageIndex === 0) {
          pageBytes = page.pageBytes;
        }
        return page;
      })
      .catch((error: unknown) => {
        if (isRangeEofError(error)) {
          eof = true;
          return null;
        }
        throw error;
      })
      .finally(() => {
        inFlight.delete(pageIndex);
      });

    inFlight.set(pageIndex, promise);
    return promise;
  };

  const applyLoadedPage = (page: Page) => {
    pages.push(page);
    records.push(...page.records);
    nextPageIndex = pages.length;
    if (page.recordCount === 0) {
      eof = true;
      return;
    }
    const totalSize = getKnownTotalSize(options.url);
    if (totalSize !== null && pageBytes > 0) {
      const pageCountFromSize = Math.ceil(totalSize / pageBytes);
      if (nextPageIndex >= pageCountFromSize) {
        eof = true;
      }
    }
  };

  const init = async (): Promise<HierarchyPagerUpdate> => {
    if (pages.length > 0) {
      return { ...snapshot(), pages: pages.slice(), records: records.slice() };
    }
    const first = await loadOne(0);
    if (first) {
      applyLoadedPage(first);
    } else {
      eof = true;
    }
    return { ...snapshot(), pages: pages.slice(), records: records.slice() };
  };

  const loadNextPages = async (count = 1): Promise<HierarchyPagerUpdate> => {
    const pageCount = Math.max(0, Math.floor(count));
    if (pageCount === 0) {
      return { ...snapshot(), pages: pages.slice(), records: records.slice() };
    }
    if (pages.length === 0) {
      await init();
    }

    for (let i = 0; i < pageCount; i += 1) {
      if (eof) {
        break;
      }
      const pageIndex = nextPageIndex;
      const page = await loadOne(pageIndex);
      if (!page) {
        eof = true;
        break;
      }
      applyLoadedPage(page);
    }

    return { ...snapshot(), pages: pages.slice(), records: records.slice() };
  };

  return { init, loadNextPages, snapshot };
};

