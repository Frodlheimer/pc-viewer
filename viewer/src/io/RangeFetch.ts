export const fetchRange = async (
  url: string,
  start: number,
  length: number,
  signal?: AbortSignal
): Promise<ArrayBuffer> => {
  if (start < 0 || length <= 0) {
    throw new Error("Invalid range request.");
  }

  const end = start + length - 1;
  const response = await fetch(url, {
    headers: {
      Range: `bytes=${start}-${end}`,
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Range fetch failed (${response.status}).`);
  }

  if (response.status === 206) {
    if (import.meta.env.DEV) {
      console.info("[range] 206 partial", { url, start, length });
    }
    return response.arrayBuffer();
  }

  const buffer = await response.arrayBuffer();
  if (start + length > buffer.byteLength) {
    throw new Error("Range slice exceeds payload size.");
  }
  if (import.meta.env.DEV) {
    console.info("[range] fallback full fetch", { url, start, length });
  }
  return buffer.slice(start, start + length);
};
