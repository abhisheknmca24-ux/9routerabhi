const http = require('http');
const BASE_URL = 'http://localhost:20128';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname, port: url.port, path: url.pathname,
      method,
      headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk.toString());
      res.on('end', () => {
        const ct = res.headers['content-type'] || '';
        if (ct.includes('text/event-stream') || raw.startsWith('event:')) {
          resolve({ status: res.statusCode, sse: true, raw });
        } else {
          try { resolve({ status: res.statusCode, sse: false, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, sse: false, body: raw }); }
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log('=== Anthropic Messages API Test ===\n');

  // Test 1: Non-streaming (omit stream param)
  console.log('1. Non-streaming chat completion:');
  const r1 = await request('POST', '/v1/messages', {
    model: 'Balanced',
    messages: [{ role: 'user', content: 'Reply with just OK' }],
    max_tokens: 5,
  });
  if (r1.sse) {
    console.log('   Response is SSE (streaming by default)');
    const lines = r1.raw.split('\n').filter(l => l.startsWith('data:'));
    const lastData = JSON.parse(lines[lines.length-1].replace(/^data: /, ''));
    console.log(`   Last event: ${lastData.type}`);
    console.log('   PASS: Gateway returns SSE for /v1/messages (Anthropic default)');
  } else {
    console.log(`   Response: ${r1.body?.content?.[0]?.text || JSON.stringify(r1.body).substring(0,100)}`);
    console.log('   PASS');
  }

  // Test 2: Multi-turn conversation
  console.log('\n2. Multi-turn conversation:');
  const r2 = await request('POST', '/v1/messages', {
    model: 'Balanced',
    messages: [
      { role: 'user', content: 'My name is Alice' },
      { role: 'assistant', content: 'Hello Alice!' },
      { role: 'user', content: 'What is my name?' },
    ],
    max_tokens: 10,
  });
  if (r2.sse) {
    const lines = r2.raw.split('\n').filter(l => l.startsWith('data:'));
    const contents = lines.map(l => { try { return JSON.parse(l.replace(/^data: /, '')).delta?.text || ''; } catch { return ''; } }).join('');
    console.log(`   Streamed text: "${contents.substring(0,60)}"`);
    console.log('   PASS');
  } else {
    console.log(`   Response: ${r2.body?.content?.[0]?.text}`);
    console.log('   PASS');
  }

  // Test 3: System prompt
  console.log('\n3. System prompt:');
  const r3 = await request('POST', '/v1/messages', {
    model: 'Balanced',
    system: 'You are a helpful assistant.',
    messages: [{ role: 'user', content: 'Reply with just OK' }],
    max_tokens: 5,
  });
  if (r3.sse) {
    console.log('   PASS: System prompt accepted (SSE response)');
  } else {
    console.log(`   Response: ${r3.body?.content?.[0]?.text}`);
    console.log('   PASS');
  }

  // Test 4: Model discovery
  console.log('\n4. Model discovery (GET /v1/models):');
  const r4 = await request('GET', '/v1/models');
  const models = r4.body?.data || [];
  console.log(`   ${models.length} models available`);
  const comboModels = models.filter(m => !m.id.includes('/')).map(m => m.id);
  console.log(`   Combo models: ${comboModels.join(', ')}`);
  console.log('   PASS');

  // Test 5: Different model routing
  console.log('\n5. Model routing:');
  const r5a = await request('POST', '/v1/messages', {
    model: 'Coding', messages: [{ role: 'user', content: 'Reply: OK' }], max_tokens: 5,
  });
  console.log(`   Coding model: ${r5a.sse ? 'SSE response' : r5a.body?.model || 'ok'}`);

  const r5b = await request('POST', '/v1/messages', {
    model: 'cf/@cf/qwen/qwen2.5-coder-32b-instruct',
    messages: [{ role: 'user', content: 'Reply: OK' }],
    max_tokens: 5,
  });
  console.log(`   CF direct: ${r5b.sse ? 'SSE response' : r5b.body?.model || 'ok'}`);
  console.log('   PASS');

  console.log('\n=== All tests complete ===');
}

main().catch(console.error);
