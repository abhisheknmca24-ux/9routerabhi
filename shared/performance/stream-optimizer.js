class StreamOptimizer {
  constructor(options = {}) {
    this.maxBufferSize = options.maxBufferSize || 65536;
    this.highWaterMark = options.highWaterMark || 16384;
    this.backpressureEnabled = options.backpressureEnabled !== false;
  }

  async createStreamHandler(response, onToken, onDone, onError) {
    let buffer = '';
    let index = 0;

    response.setEncoding('utf8');

    for await (const chunk of response) {
      buffer += chunk;
      if (this.backpressureEnabled && buffer.length > this.maxBufferSize) {
        await new Promise(resolve => setImmediate(resolve));
      }

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6);
          if (data === '[DONE]') { if (onDone) onDone(); return; }
          try {
            const parsed = JSON.parse(data);
            if (onToken) onToken(parsed, index++);
          } catch (err) {
            if (onError) onError(new Error(`Parse error: ${err.message}`));
          }
        }
      }
    }

    if (buffer.trim() && onDone) onDone();
  }

  createSSEStream(onData) {
    const { Readable } = require('stream');
    let done = false;

    const stream = new Readable({
      read() {
        if (done) this.push(null);
      },
    });

    if (typeof onData === 'function') {
      onData(
        (data) => { if (!done) stream.push(`data: ${JSON.stringify(data)}\n\n`); },
        () => { if (!done) { done = true; stream.push('data: [DONE]\n\n'); stream.push(null); } },
        (err) => { if (!done) { done = true; stream.destroy(err); } }
      );
    }

    return stream;
  }

  formatSSE(data) {
    return `data: ${JSON.stringify(data)}\n\n`;
  }

  formatDone() {
    return 'data: [DONE]\n\n';
  }
}

module.exports = { StreamOptimizer };
