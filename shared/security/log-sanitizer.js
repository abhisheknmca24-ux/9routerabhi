const SENSITIVE_PATTERNS = [
  { regex: /api[_\-]?key[=:]["']?[^"'\s,}]+/gi, replacement: '$1=[REDACTED]' },
  { regex: /(secret)[=:]\s*["']?[^"'\s,}]+/gi, replacement: '$1=[REDACTED]' },
  { regex: /(password)[=:]\s*["']?[^"'\s,}]+/gi, replacement: '$1=[REDACTED]' },
  { regex: /(token)[=:]\s*["']?[^"'\s,}]+/gi, replacement: '$1=[REDACTED]' },
  { regex: /(bearer\s+)[a-zA-Z0-9._\-]+/gi, replacement: '$1[REDACTED]' },
  { regex: /(authorization:\s*)[^\s,]+/gi, replacement: '$1[REDACTED]' },
  { regex: /x-api-key:\s*\S+/gi, replacement: 'x-api-key: [REDACTED]' },
  { regex: /sk-[a-zA-Z0-9]{20,}/g, replacement: 'sk-[REDACTED]' },
  // Note: broad hex matching such as /[a-fA-F0-9]{32,}/ was removed because it
  // redacts legitimate content like UUIDs, git hashes, and object IDs.
  // Add project-specific hex patterns below as needed.
];

class LogSanitizer {
  constructor(customPatterns = []) {
    this.patterns = [...SENSITIVE_PATTERNS, ...customPatterns];
  }

  sanitize(obj, depth = 0) {
    if (depth > 10) return '[MAX_DEPTH]';
    if (typeof obj === 'string') return this._sanitizeString(obj);
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'number' || typeof obj === 'boolean') return obj;
    if (Array.isArray(obj)) return obj.map(item => this.sanitize(item, depth + 1));
    if (typeof obj === 'object') {
      const sanitized = {};
      for (const [key, value] of Object.entries(obj)) {
        if (this._isSensitiveKey(key)) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = this.sanitize(value, depth + 1);
        }
      }
      return sanitized;
    }
    return obj;
  }

  _sanitizeString(str) {
    let result = str;
    for (const { regex, replacement } of this.patterns) {
      result = result.replace(regex, replacement);
    }
    return result;
  }

  _isSensitiveKey(key) {
    const sensitive = ['api_key', 'apiKey', 'api-key', 'secret', 'password', 'token', 'authorization', 'x-api-key', 'jwt', 'privateKey', 'private_key'];
    return sensitive.some(s => key.toLowerCase().includes(s.toLowerCase()));
  }

  sanitizeHeaders(headers) {
    const sanitized = { ...headers };
    for (const key of Object.keys(sanitized)) {
      if (this._isSensitiveKey(key)) sanitized[key] = '[REDACTED]';
    }
    return sanitized;
  }

  sanitizeBody(body) {
    return this.sanitize(body);
  }

  sanitizeQuery(query) {
    const sanitized = { ...query };
    for (const key of Object.keys(sanitized)) {
      if (this._isSensitiveKey(key)) sanitized[key] = '[REDACTED]';
    }
    return sanitized;
  }

  sanitizeUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.password) parsed.password = '[REDACTED]';
      for (const [key] of parsed.searchParams) {
        if (this._isSensitiveKey(key)) parsed.searchParams.set(key, '[REDACTED]');
      }
      return parsed.toString();
    } catch { return this._sanitizeString(url); }
  }
}

module.exports = { LogSanitizer, SENSITIVE_PATTERNS };
