/**
 * Anthropic → OpenAI format translator.
 *
 * Pure translation functions. No provider logic. No routing logic.
 * No HTTP calls. No side effects. Fully unit-testable.
 *
 * Converts Anthropic /v1/messages request bodies into OpenAI
 * /v1/chat/completions format, and vice versa.
 */

import type { AnthropicMessage } from '../formatter/anthropic-formatter.js';

// ─── Request Translation: Anthropic → OpenAI ───

export interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | Array<{ text: string }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: Array<{ name: string; description?: string; input_schema: Record<string, unknown> }>;
  tool_choice?: { type: string; name?: string };
}

export interface OpenAIRequest {
  model: string;
  messages: Array<{
    role: string;
    content: string;
    tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
    tool_call_id?: string;
  }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
  tools?: Array<{ type: string; function: { name: string; description?: string; parameters: Record<string, unknown> } }>;
  tool_choice?: string | { type: string; name?: string };
}

/**
 * Convert an Anthropic /v1/messages request body into an OpenAI
 * /v1/chat/completions body.
 *
 * Handles:
 * - messages (user, assistant roles)
 * - system prompt (string or array of text blocks)
 * - content blocks (text, image, tool_use, tool_result, thinking)
 * - tools array
 * - tool_choice
 * - max_tokens, temperature, top_p, stop_sequences
 */
export function anthropicToOpenAI(anthropic: AnthropicRequest): OpenAIRequest {
  const openaiMessages: OpenAIRequest['messages'] = [];

  // ── System prompt ──
  if (anthropic.system) {
    if (typeof anthropic.system === 'string') {
      openaiMessages.push({ role: 'system', content: anthropic.system });
    } else if (Array.isArray(anthropic.system)) {
      const text = anthropic.system
        .map((b: { text: string }) => b.text ?? '')
        .filter(Boolean)
        .join('\n');
      if (text) {
        openaiMessages.push({ role: 'system', content: text });
      }
    }
  }

  // ── Messages ──
  for (const msg of anthropic.messages) {
    const entry: OpenAIRequest['messages'][number] = {
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: '',
    };

    if (typeof msg.content === 'string') {
      entry.content = msg.content;
      openaiMessages.push(entry);
      continue;
    }

    if (!Array.isArray(msg.content)) {
      entry.content = ' ';
      openaiMessages.push(entry);
      continue;
    }

    const textParts: string[] = [];

    for (const block of msg.content) {
      switch (block.type) {
        case 'text':
          textParts.push((block as { text: string }).text);
          break;

        case 'image': {
          const src = (block as { source: { type: string; media_type: string; data?: string; url?: string } }).source;
          if (src.type === 'base64' && src.data) {
            textParts.push(`data:${src.media_type};base64,${src.data}`);
          } else if (src.type === 'url' && src.url) {
            textParts.push(src.url);
          }
          break;
        }

        case 'tool_use': {
          const tu = block as { id: string; name: string; input: Record<string, unknown> };
          entry.tool_calls = [
            { id: tu.id, type: 'function', function: { name: tu.name, arguments: JSON.stringify(tu.input) } },
          ];
          break;
        }

        case 'tool_result': {
          const tr = block as { tool_use_id: string; content: string | unknown; is_error?: boolean };
          openaiMessages.push({
            role: 'tool',
            tool_call_id: tr.tool_use_id,
            content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
          });
          continue; // Don't push the main entry below
        }

        case 'thinking':
          textParts.push(`[Thinking: ${(block as { thinking: string }).thinking}]`);
          break;

        default:
          break;
      }
    }

    entry.content = textParts.join('\n') || ' ';
    openaiMessages.push(entry);
  }

  // ── Tools ──
  let openaiTools: OpenAIRequest['tools'] | undefined;
  if (anthropic.tools && anthropic.tools.length > 0) {
    openaiTools = anthropic.tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  return {
    model: anthropic.model,
    messages: openaiMessages,
    max_tokens: anthropic.max_tokens ?? 4096,
    temperature: anthropic.temperature,
    top_p: anthropic.top_p,
    stop: anthropic.stop_sequences,
    stream: anthropic.stream ?? false,
    tools: openaiTools,
    tool_choice: anthropic.tool_choice,
  };
}

// ─── Request Translation: OpenAI → Anthropic ───

export interface OpenAIResponseChoice {
  message?: {
    content?: string;
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  };
  finish_reason?: string;
}

export interface OpenAIResponse {
  choices?: OpenAIResponseChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: { message: string };
}

/**
 * Extract content and tool calls from an OpenAI response choice.
 */
export function extractFromOpenAI(
  choice: OpenAIResponseChoice | undefined,
): {
  content: string;
  finishReason: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }> | undefined;
} {
  if (!choice) {
    return { content: '', finishReason: 'stop', toolCalls: undefined };
  }

  const content = choice.message?.content ?? '';
  const finishReason = choice.finish_reason ?? 'stop';
  const rawTools = choice.message?.tool_calls;

  let toolCalls: Array<{ id: string; name: string; arguments: string }> | undefined;

  if (rawTools && rawTools.length > 0) {
    toolCalls = rawTools.map(tc => ({
      id: tc.id,
      name: tc.function?.name ?? '',
      arguments: tc.function?.arguments ?? '{}',
    }));
  }

  return { content, finishReason, toolCalls };
}

/**
 * Extract usage information from an OpenAI response.
 */
export function extractUsage(openaiResponse: OpenAIResponse): {
  inputTokens: number;
  outputTokens: number;
} {
  return {
    inputTokens: openaiResponse.usage?.prompt_tokens ?? 0,
    outputTokens: openaiResponse.usage?.completion_tokens ?? 0,
  };
}
