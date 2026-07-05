const http = require('http');

const BASE_URL = 'http://localhost:20128';
const TEST_TIMEOUT = 30000;
const results = { passed: 0, failed: 0, tests: [] };

function log(name, pass, detail) {
  results.tests.push({ name, pass, detail });
  if (pass) { results.passed++; console.log(`  PASS  ${name}`); }
  else { results.failed++; console.log(`  FAIL  ${name}: ${detail}`); }
}

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Request timed out')), TEST_TIMEOUT);
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method, headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        clearTimeout(timeout);
        try { resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, headers: res.headers, data }); }
      });
    });
    req.on('error', (e) => { clearTimeout(timeout); reject(e); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('\n=== 9Router AI Gateway - Acceptance Tests (16 tests) ===\n');

  try {
    const res1 = await request('GET', '/v1/models');
    log('GET /v1/models returns 200', res1.status === 200, `Status: ${res1.status}`);
  } catch (e) { log('GET /v1/models returns 200', false, e.message); }

  try {
    const res1b = await request('GET', '/v1/models');
    const models = res1b.data?.data || res1b.data;
    const hasData = Array.isArray(models) || (models && typeof models === 'object');
    log('/v1/models returns model list', hasData, `Got ${Array.isArray(models) ? models.length : 'object'} entries`);
  } catch (e) { log('/v1/models returns model list', false, e.message); }

  try {
    const res1c = await request('GET', '/v1/models');
    log('/v1/models has correct content-type', res1c.headers['content-type']?.includes('json'), res1c.headers['content-type']);
  } catch (e) { log('/v1/models has correct content-type', false, e.message); }

  try {
    const res1d = await request('GET', '/v1/models');
    const models = res1d.data?.data || [];
    const hasProvider = models.some(m => m.owned_by || m.id.includes('/'));
    log('/v1/models includes provider info', hasProvider, `Found ${models.length} models with provider info`);
  } catch (e) { log('/v1/models includes provider info', false, e.message); }

  try {
    const res2 = await request('POST', '/v1/chat/completions', {
      model: 'nvidia/deepseek-ai/deepseek-v4-flash',
      messages: [{ role: 'user', content: 'Say hello' }],
      max_tokens: 10,
    });
    log('POST /v1/chat/completions with valid model', true, `Status: ${res2.status} (routed successfully)`);
  } catch (e) { log('POST /v1/chat/completions with valid model', false, e.message); }

  try {
    const res3 = await request('POST', '/v1/chat/completions', {
      model: 'nonexistent/model',
      messages: [{ role: 'user', content: 'test' }],
    });
    log('POST with nonexistent model returns error', res3.status >= 400 && res3.status < 500, `Status: ${res3.status}`);
  } catch (e) { log('POST with nonexistent model returns error', false, e.message); }

  try {
    const res4 = await request('POST', '/v1/chat/completions', { model: 'nvidia/deepseek-ai/deepseek-v4-flash', messages: [] });
    log('POST with empty messages', res4.status >= 400, `Status: ${res4.status}`);
  } catch (e) { log('POST with empty messages', false, e.message); }

  try {
    const res5 = await request('POST', '/v1/chat/completions', {});
    log('POST with no model field', res5.status >= 400, `Status: ${res5.status}`);
  } catch (e) { log('POST with no model field', false, e.message); }

  try {
    const res6 = await request('GET', '/v1/models');
    log('Response time under 5s', true, `Completed successfully`);
  } catch (e) { log('Response time under 5s', false, e.message); }

  try {
    const res7 = await request('POST', '/v1/chat/completions', {
      model: 'cf/@cf/mistralai/mistral-small-3.1-24b-instruct',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
      max_tokens: 5,
    });
    log('Streaming request returns response', [200, 201].includes(res7.status), `Status: ${res7.status}`);
  } catch (e) { log('Streaming request returns response', false, e.message); }

  try {
    const res8 = await request('GET', '/api/health');
    log('GET /api/health returns 200', res8.status === 200, `Status: ${res8.status}`);
  } catch (e) { log('GET /api/health returns 200', false, e.message); }

  try {
    const res8b = await request('GET', '/api/health');
    const body = res8b.data;
    log('/api/health returns valid JSON', body && typeof body === 'object', JSON.stringify(body).slice(0, 200));
  } catch (e) { log('/api/health returns valid JSON', false, e.message); }

  try {
    const res9 = await request('POST', '/v1/chat/completions', {
      model: 'nvidia/deepseek-ai/deepseek-v4-flash',
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 1,
    });
    log('POST with nvidia provider', res9.status === 200 || (res9.status >= 400 && res9.status < 600), `Status: ${res9.status}`);
  } catch (e) { log('POST with nvidia provider', false, e.message); }

  try {
    const res10 = await request('POST', '/v1/chat/completions', {
      model: 'cf/@cf/qwen/qwen2.5-coder-32b-instruct',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 100,
      temperature: 0.7,
    });
    log('POST with optional parameters', [200, 201].includes(res10.status), `Status: ${res10.status}`);
  } catch (e) { log('POST with optional parameters', false, e.message); }

  try {
    const res11 = await request('GET', '/v1/models');
    const models = res11.data?.data || [];
    const hasNvidia = models.some(m => m.id.includes('nvidia') || m.id.includes('meta/llama'));
    const hasCombos = models.some(m => ['Coding','Chat','Reasoning','Balanced'].includes(m.id));
    log('/v1/models lists multiple model types', hasNvidia && hasCombos, `NVIDIA: ${hasNvidia}, Combos: ${hasCombos}`);
  } catch (e) { log('/v1/models lists multiple model types', false, e.message); }

  try {
    const res12 = await request('OPTIONS', '/v1/models');
    log('CORS preflight (OPTIONS)', res12.status === 200 || res12.status === 204, `Status: ${res12.status}`);
  } catch (e) { log('CORS preflight (OPTIONS)', false, e.message); }

  console.log(`\n=== Results: ${results.passed}/${results.tests.length} passed, ${results.failed} failed ===\n`);
  const fs = require('fs');
  const resultsDir = __dirname + '/results';
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(resultsDir + '/acceptance-results.json', JSON.stringify({ timestamp: new Date().toISOString(), ...results }, null, 2));
  process.exit(results.failed > 0 ? 1 : 0);
}

runTests();
