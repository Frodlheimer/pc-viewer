import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRange, fetchRangeView } from "./RangeFetch";

describe("RangeFetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("throws when server ignores Range and fallback is disabled", async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(payload, { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchRange("https://example.invalid/range-unsupported", 0, 2, undefined, {
        allowFullFileFallback: false,
      })
    ).rejects.toThrow("Server does not support Range Requests (206).");
  });

  it("returns expected bytes for a single-window range", async () => {
    const payload = Uint8Array.from({ length: 128 }, (_value, index) => index);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(payload, {
        status: 206,
        headers: {
          "Content-Range": `bytes 0-${payload.length - 1}/${payload.length}`,
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRangeView(
      "https://example.invalid/range-ok",
      10,
      5
    );
    expect(Array.from(result)).toEqual([10, 11, 12, 13, 14]);
  });
});
