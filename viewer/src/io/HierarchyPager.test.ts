import { afterEach, describe, expect, it, vi } from "vitest";
import { createHierarchyPager } from "./HierarchyPager";

const writePch1Page = (
  view: DataView,
  offset: number,
  pageBytes: number,
  pageIndex: number,
  recordCount: number,
  nodeIdBase: number
) => {
  view.setUint8(offset, "P".charCodeAt(0));
  view.setUint8(offset + 1, "C".charCodeAt(0));
  view.setUint8(offset + 2, "H".charCodeAt(0));
  view.setUint8(offset + 3, "1".charCodeAt(0));
  view.setUint16(offset + 4, 1, true);
  view.setUint16(offset + 6, pageBytes, true);
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

describe("HierarchyPager", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads subsequent hierarchy pages on demand", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});

    const pageBytes = 256;
    const pageCount = 3;
    const fileBuffer = new ArrayBuffer(pageBytes * pageCount);
    const view = new DataView(fileBuffer);
    writePch1Page(view, 0 * pageBytes, pageBytes, 0, 1, 1);
    writePch1Page(view, 1 * pageBytes, pageBytes, 1, 1, 2);
    writePch1Page(view, 2 * pageBytes, pageBytes, 2, 1, 3);

    const url = "https://example.invalid/hierarchy-pager";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(fileBuffer, {
        status: 206,
        headers: {
          "Content-Range": `bytes 0-${fileBuffer.byteLength - 1}/${fileBuffer.byteLength}`,
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const pager = createHierarchyPager({ url, pageBytes });
    const init = await pager.init();
    expect(init.pagesLoaded).toBe(1);
    expect(init.records.map((record) => record.nodeId)).toEqual([1]);

    const loaded = await pager.loadNextPages(2);
    expect(loaded.pagesLoaded).toBe(3);
    expect(loaded.records.map((record) => record.nodeId)).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

