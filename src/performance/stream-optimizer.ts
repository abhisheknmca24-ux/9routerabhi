import { Readable } from 'node:stream';

export interface StreamOptimizerConfig {
  maxBufferSize?: number;
  backpressureEnabled?: boolean;
}

export class StreamOptimizer {
  private readonly maxBufferSize: number;
  private readonly backpressureEnabled: boolean;

  constructor(config?: StreamOptimizerConfig) {
    this.maxBufferSize = config?.maxBufferSize ?? 65536;
    this.backpressureEnabled = config?.backpressureEnabled !== false;
  }

  async createStreamHandler(
    response: AsyncIterable<string>,
    onToken: (data: unknown, index: number) => void,
    onDone?: () => void,
    onError?: (err: Error) => void,
  ): Promise<void> {
    let buffer = '';
    let index = 0;
    let done = false;

    for await (const chunk of response) {
      if (done) break;
      buffer += chunk;

      if (this.backpressureEnabled && buffer.length > this.maxBufferSize) {
        // Pause and resume on next tick to allow consumer to drain
        await new Promise<void>(resolve => setImmediate(resolve));
      }

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            done = true;
            if (onDone) onDone();
            return;
          }
          try {
            const parsed = JSON.parse(data);
            if (onToken) onToken(parsed, index++);
          } catch (err) {
            if (onError) onError(new Error(`Parse error: ${(err as Error).message}`));
          }
        }
      }
    }

    if (buffer.trim() && !done) {
      if (buffer.trim().length > 0 && onError) {
        onError(new Error(`Incomplete SSE data: ${buffer.slice(0, 100)}`));
      }
    }
    if (!done && onDone) onDone();
  }

  createSSEStream(onData?: (send: (data: unknown) => void, end: () => void, error: (err: Error) => void) => void): Readable {
    let done = false;

    const stream = new Readable({
      read() {
        if (done) this.push(null);
      },
    });

    if (typeof onData === 'function') {
      onData(
        (data: unknown) => { if (!done) stream.push(`data: ${JSON.stringify(data)}\n\n`); },
        () => { if (!done) { done = true; stream.push('data: [DONE]\n\n'); stream.push(null); } },
        (err: Error) => { if (!done) { done = true; stream.destroy(err); } },
      );
    }

    return stream;
  }

  formatSSE(data: unknown): string {
    return `data: ${JSON.stringify(data)}\n\n`;
  }

  formatDone(): string {
    return 'data: [DONE]\n\n';
  }
}
