#!/usr/bin/env node
'use strict';
const fs = require('fs');
const https = require('https');

const pairs = JSON.parse(fs.readFileSync('/tmp/fp_i18n_pairs.json', 'utf8'));
console.log('Pairs to translate:', pairs.length);

const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) { console.error('OPENAI_API_KEY not set'); process.exit(1); }

const BATCH_SIZE = 30;
const CONCURRENT = 6;

function callOpenAI(batchItems) {
  return new Promise((resolve) => {
    const items = batchItems.map((p, i) =>
      `${i+1}. ${JSON.stringify(p[0])} [EN:${JSON.stringify(p[1])}]`
    ).join('\n');
    const bodyStr = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Translate French SaaS UI strings. Return JSON {"fr_key":{"de":"...","it":"...","pt":"...","nl":"...","pl":"...","sv":"...","ro":"...","cs":"...","es":"..."},...}. Keep proper nouns, brands, URLs, numbers, emojis unchanged. Use natural localized UI language.'
        },
        {
          role: 'user',
          content: 'Translate each to de/it/pt/nl/pl/sv/ro/cs/es:\n' + items
        }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });
    const opts = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'Authorization': 'Bearer ' + OPENAI_KEY
      }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const d = JSON.parse(data);
          if (!d.choices) { console.error('No choices. Status:', res.statusCode, data.slice(0,300)); resolve({}); return; }
          const content = d.choices[0]?.message?.content || '{}';
          resolve(JSON.parse(content));
        } catch(e) { console.error('Parse error:', e.message, data.slice(0,200)); resolve({}); }
      });
    });
    req.on('error', (e) => { console.error('Req error:', e.message); resolve({}); });
    req.setTimeout(45000, () => { console.error('Timeout'); req.destroy(); resolve({}); });
    req.write(bodyStr);
    req.end();
  });
}

async function run() {
  const batches = [];
  for (let i = 0; i < pairs.length; i += BATCH_SIZE) batches.push(pairs.slice(i, i + BATCH_SIZE));
  console.log('Batches:', batches.length, 'concurrent:', CONCURRENT);

  const allResults = {};
  let done = 0;

  for (let g = 0; g < batches.length; g += CONCURRENT) {
    const group = batches.slice(g, g + CONCURRENT);
    const outputs = await Promise.all(group.map(b => callOpenAI(b)));
    for (const out of outputs) {
      for (const [fr, langs] of Object.entries(out)) {
        if (fr && typeof langs === 'object') allResults[fr] = langs;
      }
    }
    done += group.length;
    // Incremental save every 12 batches so partial progress is preserved
    if (done % 12 === 0 || done >= batches.length) {
      fs.writeFileSync('/tmp/fp_translations.json', JSON.stringify(allResults));
    }
    process.stdout.write(`\r${done}/${batches.length} batches — ${Object.keys(allResults).length} keys`);
  }
  console.log('\nTotal translated:', Object.keys(allResults).length);
  fs.writeFileSync('/tmp/fp_translations.json', JSON.stringify(allResults));
  console.log('Saved: /tmp/fp_translations.json');
}
run().catch(e => { console.error(e); process.exit(1); });
