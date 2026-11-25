export interface BufferedFrame {
  frameIdx: number;
  timestampMs: number;
  blob: Blob;
  sizeBytes: number;
}

export class ClientFrameRingBuffer {
  private buffer: BufferedFrame[] = [];
  private totalBytes: number = 0;
  private maxBytes: number;
  private maxFrames: number;

  constructor(maxMegabytes: number = 60, maxFrames: number = 300) {
    this.maxBytes = maxMegabytes * 1024 * 1024;
    this.maxFrames = maxFrames;
  }

  public push(frameIdx: number, timestampMs: number, blob: Blob) {
    const size = blob.size;
    this.buffer.push({ frameIdx, timestampMs, blob, sizeBytes: size });
    this.totalBytes += size;

    // Prune oldest frames if exceeding memory budget or max frame count
    while (
      (this.totalBytes > this.maxBytes || this.buffer.length > this.maxFrames) &&
      this.buffer.length > 1
    ) {
      const removed = this.buffer.shift();
      if (removed) {
        this.totalBytes -= removed.sizeBytes;
      }
    }
  }

  public getFrames(): BufferedFrame[] {
    return this.buffer;
  }

  public getFrame(index: number): BufferedFrame | undefined {
    return this.buffer[index];
  }

  public getCount(): number {
    return this.buffer.length;
  }

  public getMemoryUsageMB(): number {
    return Number((this.totalBytes / (1024 * 1024)).toFixed(1));
  }

  public clear() {
    this.buffer = [];
    this.totalBytes = 0;
  }
}

