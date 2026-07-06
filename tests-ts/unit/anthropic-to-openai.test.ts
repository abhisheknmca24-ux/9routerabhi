import { describe, it, expect } from 'vitest';
import {
  anthropicToOpenAI,
  extractFromOpenAI,
  extractUsage,
} from '../../src/translator/anthropic-to-openai.js';

// ═══════════════════════════════════════════════════════════════
//  Request Translation Tests
// ═══════════════════════════════════════════════════════════════

describe('anthropicToOpenAI', () => {

  it('converts a simple text message', () => {
    const result = anthropicToOpenAI({
      model: 'claude-sonnet-4-5',
      messages: [
        { role: 'user', content: 'Hello' },
      ],
      max_tokens: 100,
    });

    expect(result.model).toBe('claude-sonnet-4-5');
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content).toBe('Hello');
    expect(result.max_tokens).toBe(100);
    expect(result.stream).toBe(false);
  });

  it('converts a string system prompt to a system message', () => {
    const result = anthropicToOpenAI({
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'Hi' }],
      system: 'You are a helpful assistant.',
      max_tokens: 100,
    });

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toBe('You are a helpful assistant.');
    expect(result.messages[1].role).toBe('user');
  });

  it('converts an array system prompt to a single system message', () => {
    const result = anthropicToOpenAI({
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'Hi' }],
      system: [{ text: 'Be brief.' }, { text: 'Be accurate.' }],
      max_tokens: 100,
    });

    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toContain('Be brief.');
    expect(result.messages[0].content).toContain('Be accurate.');
  });

  it('converts assistant messages correctly', () => {
    const result = anthropicToOpenAI({
      model: 'claude-sonnet-4-5',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ],
      max_tokens: 100,
    });

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[1].role).toBe('assistant');
    expect(result.messages[1].content).toBe('Hi there!');
  });

  it('converts image content blocks (base64)', () => {
    const result = anthropicToOpenAI({
      model: 'claude-sonnet-4-5',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
        ],
      }],
      max_tokens: 100,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toContain('What is in this image?');
    expect(result.messages[0].content).toContain('data:image/png;base64,iVBORw0KGgo=');
  });

  it('converts tool_use content blocks', () => {
    const result = anthropicToOpenAI({
      model: 'claude-sonnet-4-5',
      messages: [{
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me search.' },
          { type: 'tool_use', id: 'tu123', name: 'search', input: { query: 'hello' } },
        ],
      }],
      max_tokens: 100,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].tool_calls).toBeDefined();
    expect(result.messages[0].tool_calls).toHaveLength(1);
    expect(result.messages[0].tool_calls![0].id).toBe('tu123');
    expect(result.messages[0].tool_calls![0].function.name).toBe('search');
    expect(result.messages[0].tool_calls![0].function.arguments).toBe('{"query":"hello"}');
  });

  it('converts tool_result content blocks to separate tool messages', () => {
    const result = anthropicToOpenAI({
      model: 'claude-sonnet-4-5',
      messages: [{
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu123', content: 'Result data' },
          { type: 'text', text: 'Based on that result...' },
        ],
      }],
      max_tokens: 100,
    });

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe('tool');
    expect(result.messages[0].tool_call_id).toBe('tu123');
    expect(result.messages[0].content).toBe('Result data');
    expect(result.messages[1].role).toBe('user');
    expect(result.messages[1].content).toContain('Based on that result');
  });

  it('converts thinking blocks', () => {
    const result = anthropicToOpenAI({
      model: 'claude-sonnet-4-5',
      messages: [{
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'I need to reason step by step...' },
          { type: 'text', text: 'The answer is 42.' },
        ],
      }],
      max_tokens: 100,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toContain('Thinking:');
    expect(result.messages[0].content).toContain('step by step');
    expect(result.messages[0].content).toContain('The answer is 42.');
  });

  it('converts multi-turn conversations', () => {
    const result = anthropicToOpenAI({
      model: 'claude-sonnet-4-5',
      messages: [
        { role: 'user', content: 'My name is Alice' },
        { role: 'assistant', content: 'Hello Alice!' },
        { role: 'user', content: 'What is my name?' },
      ],
      max_tokens: 100,
    });

    expect(result.messages).toHaveLength(3);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content).toBe('My name is Alice');
    expect(result.messages[1].role).toBe('assistant');
    expect(result.messages[1].content).toBe('Hello Alice!');
    expect(result.messages[2].role).toBe('user');
    expect(result.messages[2].content).toBe('What is my name?');
  });

  it('converts tools array', () => {
    const result = anthropicToOpenAI({
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'Use a tool' }],
      max_tokens: 100,
      tools: [
        { name: 'search', description: 'Search the web', input_schema: { type: 'object', properties: { q: { type: 'string' } } } },
      ],
    });

    expect(result.tools).toBeDefined();
    expect(result.tools).toHaveLength(1);
    expect(result.tools![0].function.name).toBe('search');
    expect(result.tools![0].function.description).toBe('Search the web');
  });

  it('preserves temperature, top_p, stop_sequences', () => {
    const result = anthropicToOpenAI({
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 200,
      temperature: 0.7,
      top_p: 0.9,
      stop_sequences: ['\n\n', 'END'],
    });

    expect(result.temperature).toBe(0.7);
    expect(result.top_p).toBe(0.9);
    expect(result.stop).toEqual(['\n\n', 'END']);
  });

  it('defaults max_tokens to 4096 when not provided', () => {
    const result = anthropicToOpenAI({
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.max_tokens).toBe(4096);
  });

  it('handles empty messages array', () => {
    const result = anthropicToOpenAI({
      model: 'claude-sonnet-4-5',
      messages: [],
      max_tokens: 100,
    });

    expect(result.messages).toHaveLength(0);
  });

  it('handles messages with no system prompt', () => {
    const result = anthropicToOpenAI({
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 100,
    });

    // No system message prepended
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
  });
});

// ═══════════════════════════════════════════════════════════════
//  Response Extraction Tests
// ═══════════════════════════════════════════════════════════════

describe('anthropicToOpenAI — tool-specific tests', () => {
  it('converts Anthropic tools array to OpenAI format', () => {
    const result = anthropicToOpenAI({
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'Use search tool' }],
      max_tokens: 100,
      tools: [
        {
          name: 'search',
          description: 'Search the web',
          input_schema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
    });

    expect(result.tools).toHaveLength(1);
    expect(result.tools![0].type).toBe('function');
    expect(result.tools![0].function.name).toBe('search');
    expect(result.tools![0].function.description).toBe('Search the web');
    expect(result.tools![0].function.parameters).toEqual({
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    });
  });

  it('converts tool_choice: auto', () => {
    const result = anthropicToOpenAI({
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'Use a tool' }],
      max_tokens: 100,
      tools: [{ name: 'search', input_schema: { type: 'object' } }],
      tool_choice: { type: 'auto' },
    });

    expect(result.tool_choice).toEqual({ type: 'auto' });
  });

  it('converts tool_choice: tool with specific name', () => {
    const result = anthropicToOpenAI({
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'Use search' }],
      max_tokens: 100,
      tools: [{ name: 'search', input_schema: { type: 'object' } }],
      tool_choice: { type: 'tool', name: 'search' },
    });

    expect(result.tool_choice).toEqual({ type: 'tool', name: 'search' });
  });

  it('converts multiple tool_use blocks in one assistant message', () => {
    const result = anthropicToOpenAI({
      model: 'claude-sonnet-4-5',
      messages: [{
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will search both.' },
          { type: 'tool_use', id: 'tu1', name: 'search_web', input: { q: 'hello' } },
          { type: 'tool_use', id: 'tu2', name: 'search_news', input: { topic: 'ai' } },
        ],
      }],
      max_tokens: 100,
    });

    // Two separate tool_calls should be set on the entry
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].tool_calls).toBeDefined();
  });

  it('converts tool_result with is_error flag', () => {
    const result = anthropicToOpenAI({
      model: 'claude-sonnet-4-5',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu1',
            content: 'Error: rate limited',
            is_error: true,
          },
        ],
      }],
      max_tokens: 100,
    });

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe('tool');
    expect(result.messages[0].tool_call_id).toBe('tu1');
    expect(result.messages[0].content).toBe('Error: rate limited');
  });

  it('converts tool_result with complex content', () => {
    const result = anthropicToOpenAI({
      model: 'claude-sonnet-4-5',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'calc1',
            content: JSON.stringify({ result: 42, unit: 'km' }),
          },
        ],
      }],
      max_tokens: 100,
    });

    expect(result.messages[0].content).toBe('{"result":42,"unit":"km"}');
  });

  it('preserves tool content order with mixed blocks', () => {
    const result = anthropicToOpenAI({
      model: 'claude-sonnet-4-5',
      messages: [{
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu1', content: 'Result A' },
          { type: 'text', text: 'Based on that,' },
          { type: 'tool_result', tool_use_id: 'tu2', content: 'Result B' },
          { type: 'text', text: 'and that.' },
        ],
      }],
      max_tokens: 100,
    });

    // Should be: [tool, tool, user(text+text)]
    expect(result.messages).toHaveLength(3);
    expect(result.messages[0].role).toBe('tool');
    expect(result.messages[1].role).toBe('tool');
    expect(result.messages[2].role).toBe('user');
    expect(result.messages[2].content).toContain('Based on that');
    expect(result.messages[2].content).toContain('and that.');
  });
});

describe('extractFromOpenAI', () => {
  it('extracts content and finish reason from a choice', () => {
    const choice = {
      message: { content: 'Hello world' },
      finish_reason: 'stop',
    };

    const result = extractFromOpenAI(choice);
    expect(result.content).toBe('Hello world');
    expect(result.finishReason).toBe('stop');
    expect(result.toolCalls).toBeUndefined();
  });

  it('returns empty content for undefined choice', () => {
    const result = extractFromOpenAI(undefined);
    expect(result.content).toBe('');
    expect(result.finishReason).toBe('stop');
  });

  it('extracts tool calls from a choice', () => {
    const choice = {
      message: {
        content: 'Let me search',
        tool_calls: [
          { id: 'call_1', function: { name: 'search', arguments: '{"q":"hello"}' } },
        ],
      },
      finish_reason: 'tool_calls',
    };

    const result = extractFromOpenAI(choice);
    expect(result.content).toBe('Let me search');
    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].id).toBe('call_1');
    expect(result.toolCalls![0].name).toBe('search');
    expect(result.toolCalls![0].arguments).toBe('{"q":"hello"}');
  });

  it('handles choice with missing message', () => {
    const choice = { finish_reason: 'stop' };
    const result = extractFromOpenAI(choice);
    expect(result.content).toBe('');
    expect(result.finishReason).toBe('stop');
  });
});

describe('extractUsage', () => {
  it('extracts token counts from response', () => {
    const response = {
      choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    };

    const usage = extractUsage(response);
    expect(usage.inputTokens).toBe(10);
    expect(usage.outputTokens).toBe(20);
  });

  it('returns zeros when usage is missing', () => {
    const response = {
      choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }],
    };

    const usage = extractUsage(response);
    expect(usage.inputTokens).toBe(0);
    expect(usage.outputTokens).toBe(0);
  });
});
