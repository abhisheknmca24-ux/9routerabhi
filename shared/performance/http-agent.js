const http = require('http');
const https = require('https');

class HttpAgent {
  constructor(options = {}) {
    this.timeout = options.timeout || 30000;
    this.maxRetries = options.maxRetries || 3;
    this.keepAlive = options.keepAlive !== false;
    this.maxSockets = options.maxSockets || 100;
    this.pool = new Map();

    // Create a connection pool per protocol using Node's built-in Agent
    this._httpAgent = new http.Agent({
      keepAlive: this.keepAlive,
      maxSockets: this.maxSockets,
      maxFreeSockets: Math.max(10, Math.floor(this.maxSockets / 2)),
      timeout: this.timeout,
    });
    this._httpsAgent = new https.Agent({
      keepAlive: this.keepAlive,
      maxSockets: this.maxSockets,
      maxFreeSockets: Math.max(10, Math.floor(this.maxSockets / 2)),
      timeout: this.timeout,
    });
  }

  async request(url, options = {}) {
    // Validate URL early
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    const useHttps = parsedUrl.protocol === 'https:';
    const agent = useHttps ? this._httpsAgent : this._httpAgent;
    const method = (options.method || 'GET').toUpperCase();
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    const body = options.body;
    const timeout = options.timeout || this.timeout;
    const signal = options.signal;
    const retries = options.retries !== undefined ? options.retries : this.maxRetries;

    const doRequest = async (attempt) => {
      return new Promise((resolve, reject) => {
        const req = (useHttps ? https : http).request(parsedUrl, {
          method,
          headers,
          agent,
          timeout,
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            let parsedData = null;
            try {
              parsedData = data ? JSON.parse(data) : null;
            } catch {
              parsedData = null;
            }
            resolve({
              status: res.statusCode,
              headers: res.headers,
              data: parsedData,
              raw: data,
            });
          });
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => { req.destroy(); reject(Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })); });

        if (signal) {
          if (signal.aborted) {
            req.destroy();
            return reject(Object.assign(new Error('ABORTED'), { code: 'ABORTED' }));
          }
          signal.addEventListener('abort', () => { req.destroy(); reject(Object.assign(new Error('ABORTED'), { code: 'ABORTED' })); }, { once: true });
        }

        if (body) req.write(JSON.stringify(body));
        req.end();
      });
    };

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await doRequest(attempt);
        // Treat 4xx/5xx as successful responses (caller handles them), except retry 429 with backoff
        if (result.status === 429 && attempt < retries) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }
        return result;
      } catch (err) {
        lastError = err;
        if (err.code === 'ABORTED' || err.code === 'ETIMEDOUT') {
          // Don't retry aborted or timed-out requests
          throw err;
        }
        if (attempt < retries) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise(r => setTimeout(r, backoff));
        }
      }
    }
    throw lastError;
  }

  async get(url, options = {}) {
    return this.request(url, { ...options, method: 'GET' });
  }

  async post(url, body, options = {}) {
    return this.request(url, { ...options, method: 'POST', body });
  }

  destroy() {
    this._httpAgent.destroy();
    this._httpsAgent.destroy();
    this.pool.clear();
  }
}

module.exports = { HttpAgent };
