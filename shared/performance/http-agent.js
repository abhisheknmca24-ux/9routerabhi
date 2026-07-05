class HttpAgent {
  constructor(options = {}) {
    this.timeout = options.timeout || 30000;
    this.maxRetries = options.maxRetries || 3;
    this.keepAlive = options.keepAlive !== false;
    this.maxSockets = options.maxSockets || 100;
    this.pool = new Map();
  }

  async request(url, options = {}) {
    const http = url.startsWith('https') ? require('https') : require('http');
    const method = options.method || 'GET';
    const headers = options.headers || {};
    const body = options.body;
    const timeout = options.timeout || this.timeout;
    const signal = options.signal;

    return new Promise((resolve, reject) => {
      const req = http.request(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        timeout,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              data: data ? JSON.parse(data) : null,
              raw: data,
            });
          } catch {
            resolve({ status: res.statusCode, headers: res.headers, data: null, raw: data });
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('ETIMEDOUT')); });

      if (signal) {
        signal.addEventListener('abort', () => { req.destroy(); reject(new Error('ABORTED')); });
      }

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  async get(url, options = {}) {
    return this.request(url, { ...options, method: 'GET' });
  }

  async post(url, body, options = {}) {
    return this.request(url, { ...options, method: 'POST', body });
  }

  destroy() {
    this.pool.clear();
  }
}

module.exports = { HttpAgent };
