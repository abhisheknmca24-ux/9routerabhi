import type { IncomingMessage } from 'node:http';
import { type ClientType, type ProtocolType, type ClientInfo, type DetectionResult } from '../types/api.types.js';

/** User-agent patterns mapped to client types */
const UA_PATTERNS: Array<{ pattern: RegExp; client: ClientType }> = [
  { pattern: /ClaudeDesktop/i, client: 'claude-desktop' },
  { pattern: /Claude-API/i, client: 'claude-cli' },
  { pattern: /ClaudeCode/i, client: 'claude-code' },
  { pattern: /cursor/i, client: 'cursor' },
  { pattern: /Continue/i, client: 'continue-dev' },
  { pattern: /Roo?Code|Roo-Cline/i, client: 'roo-code' },
  { pattern: /Cline/i, client: 'cline' },
  { pattern: /vscode/i, client: 'vscode-ai' },
  { pattern: /OpenAI/i, client: 'openai-compatible' },
  { pattern: /Anthropic/i, client: 'anthropic-compatible' },
  { pattern: /axios|node-fetch|python-requests|curl|wget/i, client: 'openai-compatible' },
];

/** Detect client from request headers */
export function detectClient(req: IncomingMessage): DetectionResult {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  const url = req.url || '';
  const method = req.method || '';

  // Check known patterns first
  for (const { pattern, client } of UA_PATTERNS) {
    if (pattern.test(ua)) {
      return { client, protocol: detectProtocol(method, url), confidence: 0.9 };
    }
  }

  // Check for anthropic-specific headers
  if (req.headers['anthropic-version']) {
    return { client: 'anthropic-compatible', protocol: detectProtocol(method, url), confidence: 0.85 };
  }

  // Check for OpenAI-specific headers
  if (req.headers['openai-organization'] || req.headers['openai-project']) {
    return { client: 'openai-compatible', protocol: detectProtocol(method, url), confidence: 0.85 };
  }

  // Default by API path
  const protocol = detectProtocol(method, url);
  if (protocol === 'anthropic-messages') {
    return { client: 'anthropic-compatible', protocol, confidence: 0.7 };
  }
  if (protocol === 'openai-chat' || protocol === 'openai-models') {
    return { client: 'openai-compatible', protocol, confidence: 0.7 };
  }

  return { client: 'unknown', protocol, confidence: 0.3 };
}

/** Detect protocol from HTTP method + URL path */
export function detectProtocol(method: string, url: string): ProtocolType {
  const path = url.split('?')[0];

  if (path === '/v1/chat/completions' && method === 'POST') return 'openai-chat';
  if (path === '/v1/messages' && method === 'POST') return 'anthropic-messages';
  if (path === '/v1/models' && method === 'GET') return 'openai-models';
  if (path === '/api/health' && method === 'GET') return 'health';

  return 'unknown';
}

/** Build full client context from request */
export function buildClientInfo(req: IncomingMessage): ClientInfo {
  const detection = detectClient(req);
  const ip = (req.headers['x-9r-real-ip'] as string) ||
             (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
             req.socket?.remoteAddress ||
             'unknown';

  return {
    type: detection.client,
    protocol: detection.protocol,
    userAgent: (req.headers['user-agent'] || 'unknown') as string,
    ip,
    clientVersion: (req.headers['anthropic-version'] as string) || undefined,
  };
}

/** Human-readable client name */
export function getClientDisplayName(client: ClientType): string {
  const names: Record<ClientType, string> = {
    'claude-desktop': 'Claude Desktop',
    'claude-code': 'Claude Code',
    'claude-cli': 'Claude CLI',
    cursor: 'Cursor',
    'continue-dev': 'Continue.dev',
    'roo-code': 'RooCode',
    cline: 'Cline',
    'vscode-ai': 'VS Code AI',
    'openai-compatible': 'OpenAI Compatible',
    'anthropic-compatible': 'Anthropic Compatible',
    unknown: 'Unknown Client',
  };
  return names[client] || 'Unknown Client';
}
