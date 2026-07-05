const crypto = require('crypto');

class AuthMiddleware {
  constructor(options = {}) {
    this.apiKeySecret = options.apiKeySecret || process.env.API_KEY_SECRET;
    this.jwtSecret = options.jwtSecret || process.env.JWT_SECRET;
    this.requireAuth = options.requireAuth || process.env.REQUIRE_API_KEY === 'true';
    this.sessionTimeout = options.sessionTimeout || 3600000;
    this.sessions = new Map();
  }

  authenticate(req, res, next) {
    if (!this.requireAuth) return next();

    const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    if (!apiKey) {
      return res.status(401).json({ error: { message: 'API key required', type: 'authentication_error' } });
    }

    if (this._validateApiKey(apiKey)) return next();

    const token = this._validateJWT(apiKey);
    if (token) return next();

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
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return false;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      if (payload.exp && Date.now() >= payload.exp * 1000) return false;
      return true;
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
