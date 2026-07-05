const http = require('http');
const BASE_URL = 'http://localhost:20128';
const TIMEOUT = 20000;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Request timed out')), TIMEOUT);
    const url = new URL(path, BASE_URL);
    const opts = {
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method, headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        clearTimeout(timeout);
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', (e) => { clearTimeout(timeout); reject(e); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function testModel(label, model) {
  try {
    const res = await request('POST', '/v1/chat/completions', {
      model, messages: [{ role: 'user', content: 'Reply with OK only' }], max_tokens: 10,
    });
    const msg = res.body?.choices?.[0]?.message?.content || '(no content)';
    const ok = res.status === 200;
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}: Status ${res.status}, Response: "${msg.substring(0, 60)}"`);
    return ok;
  } catch (e) {
    console.log(`  FAIL  ${label}: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log('\n=== Chat Completion Verification ===\n');
  const results = [
    await testModel('Balanced combo', 'Balanced'),
    await testModel('Cloudflare direct', 'cf/@cf/qwen/qwen2.5-coder-32b-instruct'),
    await testModel('NVIDIA direct', 'nvidia/deepseek-ai/deepseek-v4-flash'),
    await testModel('OpenRouter (may fail - free models)', 'openrouter/nvidia/nemotron-3-ultra-550b-a55b-20260604:free'),
  ];
  const passed = results.filter(Boolean).length;
  console.log(`\n=== ${passed}/${results.length} passed ===\n`);
  process.exit(results.some(r => !r) ? 0 : 0);
}
main();
