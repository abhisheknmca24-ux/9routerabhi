# User Guide

## Overview

The 9Router AI Gateway provides a unified API endpoint for multiple AI model providers with automatic failover. You can use any OpenAI-compatible client or the Anthropic Messages API.

## Making API Calls

### OpenAI-Compatible (Chat Completions)

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Balanced",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Anthropic Messages API

```bash
curl http://localhost:20128/v1/messages \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "Balanced",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 100
  }'
```

### Streaming

```bash
curl http://localhost:20128/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Balanced",
    "messages": [{"role": "user", "content": "Count to 5"}],
    "stream": true
  }'
```

## Available Models

### Combo Profiles (Auto-Failover)

Use these models for automatic fallback across providers:

- **Coding** — Best for programming tasks
- **Reasoning** — Best for complex reasoning
- **Chat** — General conversation
- **Balanced** — Recommended default
- **Vision** — Image understanding
- **Research** — Deep research tasks
- **Fast** — Low-latency responses
- **Long_Context** — Large document processing
- **Planning** — Task planning

### Direct Models

Use provider-specific models for direct access:

**NVIDIA (8 models):**
- `nvidia/minimaxai/minimax-m2.7`
- `nvidia/minimaxai/minimax-m3`
- `nvidia/deepseek-ai/deepseek-v4-pro`
- `nvidia/deepseek-ai/deepseek-v4-flash`
- `nvidia/moonshotai/kimi-k2.6`
- `nvidia/nemotron-3-ultra-550b-a55b`
- `nvidia/z-ai/glm-5.2`
- `nvidia/parakeet-ctc-1.1b-asr`

**Cloudflare (13 models):**
- `cf/@cf/meta/llama-3.2-1b-instruct`
- `cf/@cf/meta/llama-3.2-3b-instruct`
- `cf/@cf/meta/llama-3.1-8b-instruct-fp8-fast`
- `cf/@cf/meta/llama-3.1-8b-instruct-awq`
- `cf/@cf/mistralai/mistral-small-3.1-24b-instruct`
- `cf/@cf/meta/llama-3.1-70b-instruct-fp8-fast`
- `cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- `cf/@cf/deepseek-ai/deepseek-r1-distill-qwen-32b`
- `cf/@cf/moonshotai/kimi-k2.5`
- `cf/@cf/moonshotai/kimi-k2.6`
- `cf/@cf/zai-org/glm-4.7-flash`
- `cf/@cf/qwen/qwq-32b`
- `cf/@cf/qwen/qwen2.5-coder-32b-instruct`

## Using with Claude Desktop

### Prerequisites
- Claude Desktop installed
- Gateway running on port 20128

### Configuration

1. Open Claude Desktop
2. Go to **Help → Troubleshooting → Enable Developer Mode**
3. Go to **Developer → Configure Third-Party Inference**
4. Set **Inference provider** to **Gateway**
5. Set **Gateway base URL** to `http://localhost:20128`
6. Set **Gateway API key** to `sk-placeholder`
7. Click **Apply**
8. Start a new conversation

Claude Desktop will auto-discover available models. Use any combo profile (Balanced recommended) or direct model.

## Using with Claude Code

Claude Code CLI auto-detects the gateway configuration from:
- Project-level `claude.jsonc` in the working directory
- User-level `~/.claude/settings.json`

The gateway URL and API key are pre-configured. Start Claude Code in the `ai-gateway` project directory to use it.

## Using with Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:20128",
    api_key="sk-placeholder"
)

response = client.chat.completions.create(
    model="Balanced",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

## Using with Node.js

```javascript
const OpenAI = require('openai');
const client = new OpenAI({
  baseURL: 'http://localhost:20128',
  apiKey: 'sk-placeholder',
});

const response = await client.chat.completions.create({
  model: 'Balanced',
  messages: [{ role: 'user', content: 'Hello!' }],
});
console.log(response.choices[0].message.content);
```
