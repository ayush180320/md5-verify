import { createMD5 } from "hash-wasm";

const SMALL_FILE_LIMIT = 512 * 1024 * 1024;
const CHUNK_SIZE       = 256 * 1024 * 1024;
const READ_AHEAD       = 3;

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { mode: "hash"; file: File } | { mode: "benchmark" };

  if (msg.mode === "benchmark") {
    const SIZE = 256 * 1024 * 1024;
    const buf  = new Uint8Array(SIZE);
    const view = new Uint32Array(buf.buffer);
    let seed = 0xdeadbeef;
    for (let i = 0; i < view.length; i++) {
      seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
      view[i] = seed >>> 0;
    }
    const hasher = await createMD5();
    hasher.init();
    const t0 = performance.now();
    hasher.update(buf);
    hasher.digest();
    const elapsed    = (performance.now() - t0) / 1000;
    const speedBps   = SIZE / elapsed;
    const twoTbBytes = 2 * 1024 * 1024 * 1024 * 1024;
    self.postMessage({ type: "benchmarkDone", speedBps, estimatedSeconds: twoTbBytes / speedBps });
    return;
  }

  const { file } = msg;
  const hasher = await createMD5();
  hasher.init();
  const startTime = performance.now();

  if (file.size <= SMALL_FILE_LIMIT) {
    const buffer = await file.arrayBuffer();
    hasher.update(new Uint8Array(buffer));
    const elapsed = (performance.now() - startTime) / 1000 || 0.001;
    self.postMessage({ type: "progress", progress: 1, speed: file.size / elapsed, estimatedRemaining: null });
  } else {
    let usedByob = false;
    try {
      // @ts-ignore
      const reader = (file.stream() as ReadableStream).getReader({ mode: "byob" }) as ReadableStreamBYOBReader;
      let buf    = new ArrayBuffer(CHUNK_SIZE);
      let offset = 0;
      while (offset < file.size) {
        const toRead = Math.min(CHUNK_SIZE, file.size - offset);
        const { done, value } = await reader.read(new Uint8Array(buf, 0, toRead));
        if (done) break;
        hasher.update(value);
        buf     = value.buffer;
        offset += value.byteLength;
        const elapsed   = (performance.now() - startTime) / 1000 || 0.001;
        const speed     = offset / elapsed;
        const remaining = (file.size - offset) / speed;
        self.postMessage({
          type: "progress",
          progress: offset / file.size,
          speed,
          estimatedRemaining: isFinite(remaining) && remaining > 0 ? remaining : null,
        });
      }
      reader.releaseLock();
      usedByob = true;
    } catch {}

    if (!usedByob) {
      const queue: Promise<ArrayBuffer>[] = [];
      function enqueue(off: number) {
        if (off < file.size)
          queue.push(file.slice(off, Math.min(off + CHUNK_SIZE, file.size)).arrayBuffer());
      }
      for (let i = 0; i < READ_AHEAD; i++) enqueue(i * CHUNK_SIZE);
      let offset = 0;
      while (queue.length > 0) {
        enqueue(offset + READ_AHEAD * CHUNK_SIZE);
        const buffer = await queue.shift()!;
        hasher.update(new Uint8Array(buffer));
        offset += buffer.byteLength;
        const elapsed   = (performance.now() - startTime) / 1000 || 0.001;
        const speed     = offset / elapsed;
        const remaining = (file.size - offset) / speed;
        self.postMessage({
          type: "progress",
          progress: offset / file.size,
          speed,
          estimatedRemaining: isFinite(remaining) && remaining > 0 ? remaining : null,
        });
      }
    }
  }

  const hash    = hasher.digest();
  const elapsed = (performance.now() - startTime) / 1000;
  self.postMessage({ type: "done", hash, elapsed });
};
