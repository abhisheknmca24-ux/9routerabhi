class SecurityHeaders {
  constructor(options = {}) {
    this.headers = {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      // Note: X-XSS-Protection is intentionally omitted. It is deprecated by all
      // modern browsers and can actually introduce XSS vulnerabilities in legacy
      // browsers. CSP provides proper XSS protection.
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Content-Security-Policy': "default-src 'self'",
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      // Conditional caching: the primary API responses should not be cached,
      // but individual routes can override this with route-level middleware.
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      // Modern security headers
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-DNS-Prefetch-Control': 'off',
      'X-Permitted-Cross-Domain-Policies': 'none',
      ...options.customHeaders,
    };
  }

  apply(req, res, next) {
    for (const [key, value] of Object.entries(this.headers)) {
      res.setHeader(key, value);
    }
    if (typeof next === 'function') {
      next();
    }
  }

  addHeader(key, value) { this.headers[key] = value; }
  removeHeader(key) { delete this.headers[key]; }

  // Allow per-route Cache-Control override for cacheable resources
  allowCaching(maxAge = 3600) {
    this.headers['Cache-Control'] = `public, max-age=${maxAge}`;
    delete this.headers['Pragma'];
  }
}

module.exports = { SecurityHeaders };
