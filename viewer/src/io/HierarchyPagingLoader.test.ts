import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPage } from "./HierarchyPagingLoader";

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
});
