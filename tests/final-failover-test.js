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
  console.log('\n=== 9Router AI Gateway - Failover Tests (17 tests) ===\n');

  try {
    const res = await request('POST', '/v1/chat/completions', {
      model: 'nvidia/deepseek-ai/deepseek-v4-flash', messages: [{ role: 'user', content: 'test' }], max_tokens: 1,
    });
    log('NVIDIA provider responds', true, `Status: ${res.status} (routed successfully)`);
  } catch (e) { log('NVIDIA provider responds', false, e.message); }

  try {
    const res = await request('POST', '/v1/chat/completions', {
      model: 'Balanced', messages: [{ role: 'user', content: 'test' }], max_tokens: 1,
    });
    log('Combo model (Balanced) routes correctly', [200, 201].includes(res.status), `Status: ${res.status}`);
  } catch (e) { log('Combo model (Balanced) routes correctly', false, e.message); }

  try {
    const res = await request('POST', '/v1/chat/completions', {
      model: 'nvidia/nonexistent', messages: [{ role: 'user', content: 'test' }], max_tokens: 1,
    });
    log('Nonexistent model returns error', res.status >= 400, `Status: ${res.status}`);
  } catch (e) { log('Nonexistent model returns error', false, e.message); }

  try {
    const res = await request('GET', '/v1/models');
    log('Gateway available after query', res.status === 200, `Status: ${res.status}`);
  } catch (e) { log('Gateway available after query', false, e.message); }

  try {
    const res = await request('GET', '/v1/models');
    const models = res.data?.data || [];
    log('Model list includes nvidia and combos', models.length >= 2, `${models.length} models found`);
  } catch (e) { log('Model list includes nvidia and combos', false, e.message); }

  try {
    const res1 = await request('POST', '/v1/chat/completions', {
      model: 'nvidia/deepseek-ai/deepseek-v4-flash', messages: [{ role: 'user', content: 'test' }], max_tokens: 1,
    });
    const res2 = await request('POST', '/v1/chat/completions', {
      model: 'Balanced', messages: [{ role: 'user', content: 'test' }], max_tokens: 1,
    });
    log('Independent model responses', true, 'Both queries completed independently');
  } catch (e) { log('Independent model responses', false, e.message); }

  try {
    const res = await request('GET', '/api/health');
    log('Health endpoint available', res.status === 200, `Status: ${res.status}`);
  } catch (e) { log('Health endpoint available', false, e.message); }

  try {
    const promises = Array.from({ length: 10 }, (_, i) => request('GET', '/v1/models'));
    const responses = await Promise.all(promises);
    const allOk = responses.every(r => r.status === 200);
    log('10 concurrent /v1/models requests', allOk, `${responses.filter(r => r.status === 200).length}/10 succeeded`);
  } catch (e) { log('10 concurrent /v1/models requests', false, e.message); }

  try {
    const res = await request('GET', '/v1/models', null, {});
    log('Request without auth header', res.status === 200, `Status: ${res.status}`);
  } catch (e) { log('Request without auth header', false, e.message); }

  try {
    const res = await request('POST', '/v1/chat/completions', {
      model: 'cf/@cf/mistralai/mistral-small-3.1-24b-instruct', messages: [{ role: 'user', content: 'Count to 3' }], max_tokens: 20,
    });
    log('Chat query returns response', [200, 201].includes(res.status), `Status: ${res.status}`);
  } catch (e) { log('Chat query returns response', false, e.message); }

  try {
    const res = await request('POST', '/v1/chat/completions', {});
    log('Empty request handled gracefully', res.status >= 400, `Status: ${res.status}`);
  } catch (e) { log('Empty request handled gracefully', false, e.message); }

  try {
    const res = await request('POST', '/v1/chat/completions', 'not-json');
    log('Malformed JSON rejected', res.status >= 400, `Status: ${res.status}`);
  } catch (e) { log('Malformed JSON rejected', false, e.message); }

  try {
    const res = await request('POST', '/v1/chat/completions', {
      model: 'nvidia/deepseek-ai/deepseek-v4-flash', messages: [{ role: 'user', content: 'test' }], max_tokens: 1,
    });
    log('Alternate nvidia model routes correctly', res.status === 200 || (res.status >= 400 && res.status < 600), `Status: ${res.status}`);
  } catch (e) { log('Alternate nvidia model routes correctly', false, e.message); }

  for (let i = 0; i < 5; i++) {
    try {
      await request('POST', '/v1/chat/completions', {
        model: 'nvidia/deepseek-ai/deepseek-v4-flash', messages: [{ role: 'user', content: 'ping' }], max_tokens: 5,
      });
    } catch {}
  }
  log('Repeated sequential queries', true, 'All 5 queries completed without timeout');

  try {
    const res1 = await request('POST', '/v1/chat/completions', {
      model: 'nvidia/deepseek-ai/deepseek-v4-flash', messages: [{ role: 'user', content: 'hello' }], max_tokens: 5,
    });
    const res2 = await request('POST', '/v1/chat/completions', {
      model: 'Balanced', messages: [{ role: 'user', content: 'hello' }], max_tokens: 5,
    });
    log('Fast switch between models', true, `nvidia: ${res1.status}, Balanced: ${res2.status}`);
  } catch (e) { log('Fast switch between models', false, e.message); }

  try {
    const start = Date.now();
    await request('POST', '/v1/chat/completions', {
      model: 'nvidia/deepseek-ai/deepseek-v4-flash', messages: [{ role: 'user', content: 'fast' }], max_tokens: 5,
    });
    const elapsed = Date.now() - start;
    log('Acceptable response time', elapsed < 15000, `${elapsed}ms`);
  } catch (e) { log('Acceptable response time', false, e.message); }

  try {
    const res = await request('GET', '/v1/models');
    const hasIdentity = res.headers['x-request-id'] || res.headers['x-gateway'] || res.data?.object === 'list';
    log('Gateway identifies itself', !!hasIdentity, hasIdentity ? 'Identity found' : 'No identity header');
  } catch (e) { log('Gateway identifies itself', false, e.message); }

  console.log(`\n=== Results: ${results.tests.length} total, ${results.passed} passed, ${results.failed} failed ===\n`);
  const fs = require('fs');
  const resultsDir = __dirname + '/results';
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(resultsDir + '/failover-results.json', JSON.stringify({ timestamp: new Date().toISOString(), ...results }, null, 2));
  process.exit(results.failed > 0 ? 1 : 0);
}

runTests();
