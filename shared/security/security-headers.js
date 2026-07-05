class SecurityHeaders {
  constructor(options = {}) {
    this.headers = {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Content-Security-Policy': "default-src 'self'",
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      ...options.customHeaders,
    };
  }

  apply(req, res, next) {
    for (const [key, value] of Object.entries(this.headers)) {
      res.setHeader(key, value);
    }
    next();
  }

  addHeader(key, value) { this.headers[key] = value; }
  removeHeader(key) { delete this.headers[key]; }
}

module.exports = { SecurityHeaders };
