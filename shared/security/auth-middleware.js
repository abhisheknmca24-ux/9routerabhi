const crypto = require('crypto');

class AuthMiddleware {
  constructor(options = {}) {
    this.apiKeySecret = options.apiKeySecret || process.env.API_KEY_SECRET;
    this.jwtSecret = options.jwtSecret || process.env.JWT_SECRET;
    // In production, auth is required by default. Set REQUIRE_API_KEY=false to disable.
    this.requireAuth = options.requireAuth !== undefined ? options.requireAuth : process.env.REQUIRE_API_KEY !== 'false';
    this.sessionTimeout = options.sessionTimeout || 3600000;
    this.sessions = new Map();
  }

  authenticate(req, res, next) {
    if (!this.requireAuth) {
      // Log a warning on first startup that auth is disabled
      if (!this._warned) {
        console.warn('WARNING: Authentication is DISABLED. Set REQUIRE_API_KEY=true in production.');
        this._warned = true;
      }
      return next();
    }

    const authHeader = req.headers['authorization'];
    let apiKey = req.headers['x-api-key'];

    if (authHeader && authHeader.startsWith('Bearer ')) {
      apiKey = apiKey || authHeader.slice(7);
    } else if (authHeader && !apiKey) {
      apiKey = authHeader;
    }

    if (!apiKey) {
      return res.status(401).json({ error: { message: 'API key required', type: 'authentication_error' } });
    }

    if (this._validateApiKey(apiKey)) return next();

    if (this._validateJWT(apiKey)) return next();

    return res.status(401).json({ error: { message: 'Invalid API key', type: 'authentication_error' } });
  }

  _validateApiKey(key) {
    if (!this.apiKeySecret) return false;
    try {
      const keyBuf = Buffer.from(key);
      const secretBuf = Buffer.from(this.apiKeySecret);
      if (keyBuf.length !== secretBuf.length) return false;
      return crypto.timingSafeEqual(keyBuf, secretBuf);
    } catch {
      return false;
    }
  }

  _validateJWT(token) {
    if (!this.jwtSecret) return false;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return false;

      // Verify HMAC-SHA256 signature
      const header = parts[0];
      const payload = parts[1];
      const signature = parts[2];

      // Decode and check payload expiration
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (decoded.exp && Date.now() >= decoded.exp * 1000) return false;

      // Recompute HMAC and compare in constant time
      const expectedSig = crypto.createHmac('sha256', this.jwtSecret)
        .update(`${header}.${payload}`)
        .digest('base64url');
      const sigBuf = Buffer.from(signature);
      const expectedBuf = Buffer.from(expectedSig);
      if (sigBuf.length !== expectedBuf.length) return false;
      return crypto.timingSafeEqual(sigBuf, expectedBuf);
    } catch { return false; }
  }

  generateSession(user, ttl) {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + (ttl || this.sessionTimeout);
    this.sessions.set(sessionId, { user, expires, createdAt: Date.now() });
    return { sessionId, expires };
  }

  validateSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (Date.now() > session.expires) { this.sessions.delete(sessionId); return null; }
    return session;
  }

  revokeSession(sessionId) { this.sessions.delete(sessionId); }
}

module.exports = { AuthMiddleware };
