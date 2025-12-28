import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAllPages, loadPage } from "./HierarchyPagingLoader";

const buildPch1Page = (pageBytes: number) => {
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

const writePch1Page = (
  view: DataView,
  offset: number,
  pageBytesField: number,
  pageIndex: number,
  recordCount: number,
  nodeIdBase: number
) => {
  view.setUint8(offset, "P".charCodeAt(0));
  view.setUint8(offset + 1, "C".charCodeAt(0));
  view.setUint8(offset + 2, "H".charCodeAt(0));
  view.setUint8(offset + 3, "1".charCodeAt(0));
  view.setUint16(offset + 4, 1, true);
  view.setUint16(offset + 6, pageBytesField, true);
  view.setUint32(offset + 8, pageIndex, true);
  view.setUint32(offset + 12, recordCount, true);
  view.setUint32(offset + 16, 0, true);

  for (let i = 0; i < recordCount; i += 1) {
    const recordOffset = offset + 20 + i * 80;
    view.setBigUint64(recordOffset, BigInt(nodeIdBase + i), true);
    view.setBigUint64(recordOffset + 8, 0n, true);
    view.setUint8(recordOffset + 16, 0);
    view.setUint8(recordOffset + 17, 0);
    view.setUint16(recordOffset + 18, 0, true);
    view.setUint32(recordOffset + 20, 1, true);
    for (let j = 0; j < 6; j += 1) {
      view.setInt32(recordOffset + 24 + j * 4, 0, true);
    }
    view.setUint16(recordOffset + 48, 0, true);
    view.setUint16(recordOffset + 50, 0, true);
    view.setBigUint64(recordOffset + 52, 0n, true);
    view.setUint32(recordOffset + 60, 0, true);
    view.setUint32(recordOffset + 64, 0, true);
    view.setBigUint64(recordOffset + 68, 0n, true);
    view.setUint32(recordOffset + 76, 0, true);
  }
};

describe("HierarchyPagingLoader", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses header pageBytes when no override is provided", async () => {
    const pageBytes = 1024;
    const buffer = buildPch1Page(pageBytes);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(buffer, {
        status: 206,
        headers: {
          "Content-Range": `bytes 0-${pageBytes - 1}/${pageBytes}`,
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const page = await loadPage("https://example.invalid/hierarchy", 0);
    expect(page.pageBytes).toBe(pageBytes);
    expect(page.recordCount).toBe(0);
  });

  it("stops cleanly on EOF when total size is unknown and server returns 416", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const pageBytes = 64 * 1024;
    const pagesInFirstWindow = 256;
    const url = "https://example.invalid/hierarchy-eof-416";
    const buffer = new ArrayBuffer(pageBytes * pagesInFirstWindow);
    const view = new DataView(buffer);

    for (let pageIndex = 0; pageIndex < pagesInFirstWindow; pageIndex += 1) {
      writePch1Page(view, pageIndex * pageBytes, 0, pageIndex, 1, pageIndex + 1);
    }

    const fetchMock = vi
      .fn()
      .mockImplementation((_input: unknown, init?: RequestInit) => {
        const rangeHeader =
          (init?.headers as Record<string, string> | undefined)?.Range ?? "";
        if (rangeHeader.startsWith("bytes=0-")) {
          return Promise.resolve(
            new Response(buffer, {
              status: 206,
              headers: {
                "Content-Range": `bytes 0-${buffer.byteLength - 1}/*`,
              },
            })
          );
        }
        return Promise.resolve(
          new Response(new ArrayBuffer(0), {
            status: 416,
          })
        );
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadAllPages(url, { maxPages: pagesInFirstWindow + 4 });
    expect(result.pages).toHaveLength(pagesInFirstWindow);
    expect(result.records).toHaveLength(pagesInFirstWindow);
    expect(result.records[0]?.nodeId).toBe(1);
    expect(result.records[result.records.length - 1]?.nodeId).toBe(
      pagesInFirstWindow
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
