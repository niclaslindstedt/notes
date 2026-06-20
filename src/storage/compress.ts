// gzip/gunzip over raw bytes, built on the browser-native `CompressionStream` /
// `DecompressionStream` so the app stays dependency-free. Used to shrink a
// document (and each attachment's bytes) before it is encrypted at rest:
// compress-then-encrypt, so the ciphertext carries the smaller compressed form.
//
// Pure and I/O-free — no React, no storage. Node's test environment exposes the
// same Web Streams globals, so these run unchanged under vitest.

// Drive `input` through a (de)compression transform and collect the result.
// We feed the whole buffer in one write and close, then drain the readable —
// the inputs here (a note document, one image) comfortably fit in memory, so
// there is no need to stream incrementally.
async function run(
  input: Uint8Array,
  transform: {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<BufferSource>;
  },
): Promise<Uint8Array<ArrayBuffer>> {
  const writer = transform.writable.getWriter();
  void writer.write(input as BufferSource);
  void writer.close();

  const reader = transform.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Compress raw bytes with gzip. */
export function gzip(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return run(bytes, new CompressionStream("gzip"));
}

/** Decompress gzip bytes produced by {@link gzip}. */
export function gunzip(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return run(bytes, new DecompressionStream("gzip"));
}

/** Compress a UTF-8 string with gzip. */
export function gzipText(text: string): Promise<Uint8Array<ArrayBuffer>> {
  return gzip(new TextEncoder().encode(text));
}

/** Decompress gzip bytes back into a UTF-8 string. */
export async function gunzipText(bytes: Uint8Array): Promise<string> {
  return new TextDecoder().decode(await gunzip(bytes));
}
