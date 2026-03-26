const fs = require('fs');
const path = require('path');
const vm = require('vm');
const axios = require('axios');

const API_URL = process.argv[2] || 'http://localhost:5000';
const SOURCE_FILE = path.resolve(__dirname, 'test_basic_questionnaire_all_copy.js');
const OUTPUT_FILE = path.resolve(__dirname, 'basic_field_by_field_report.json');

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;

  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (!inDouble && !inTemplate && ch === '\'') {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && !inTemplate && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && ch === '`') {
      inTemplate = !inTemplate;
      continue;
    }

    if (inSingle || inDouble || inTemplate) continue;

    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function extractObjectLiteral(source, constName) {
  const marker = `const ${constName} = {`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Could not find object for "${constName}"`);
  }

  const openBraceIndex = source.indexOf('{', markerIndex);
  const closeBraceIndex = findMatchingBrace(source, openBraceIndex);
  if (openBraceIndex === -1 || closeBraceIndex === -1) {
    throw new Error(`Could not parse object literal for "${constName}"`);
  }

  return source.slice(openBraceIndex, closeBraceIndex + 1);
}

function parseObjectLiteral(literal) {
  return vm.runInNewContext(`(${literal})`, {});
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function runOneCase(label, payload) {
  const saveRes = await axios.post(
    `${API_URL}/api/save-assessment`,
    {
      userDetails: payload.userDetails,
      assessmentResponses: payload.responses,
      assessmentType: 'Building'
    },
    { timeout: 30000 }
  );

  if (saveRes.status !== 201 || !saveRes.data?.assessmentId) {
    throw new Error(`${label}: save failed with status ${saveRes.status}`);
  }

  const assessmentId = saveRes.data.assessmentId;
  const getRes = await axios.get(`${API_URL}/api/assessment/${assessmentId}`, { timeout: 30000 });
  const doc = getRes.data || {};
  const flatSaved = doc.responses || {};
  const rawSaved = doc.assessmentResponses?.raw_responses || doc.assessmentResponses || {};

  const fields = Object.keys(payload.responses).sort().map((key) => {
    const expected = payload.responses[key];

    const flatExists = Object.prototype.hasOwnProperty.call(flatSaved, key);
    const rawExists = Object.prototype.hasOwnProperty.call(rawSaved, key);
    const flatActual = flatExists ? flatSaved[key] : undefined;
    const rawActual = rawExists ? rawSaved[key] : undefined;
    const flatMatch = flatExists && deepEqual(expected, flatActual);
    const rawMatch = rawExists && deepEqual(expected, rawActual);

    return {
      key,
      expected,
      responses: {
        exists: flatExists,
        match: flatMatch,
        actual: flatActual
      },
      raw_responses: {
        exists: rawExists,
        match: rawMatch,
        actual: rawActual
      },
      overallPass: flatMatch && rawMatch
    };
  });

  const failedFields = fields.filter((f) => !f.overallPass).map((f) => f.key);

  return {
    label,
    assessmentId,
    totalFields: fields.length,
    passedFields: fields.length - failedFields.length,
    allPass: failedFields.length === 0,
    failedFieldKeys: failedFields,
    fields
  };
}

async function main() {
  const source = fs.readFileSync(SOURCE_FILE, 'utf8');

  const cases = [
    { label: 'RCC Structure', varName: 'rcc' },
    { label: 'Steel Structure', varName: 'steel' },
    { label: 'Composite Structure (RCC+Steel)', varName: 'composite' },
    { label: 'Heritage Structure', varName: 'heritage' },
    { label: 'Load Bearing Masonry', varName: 'loadbearing' }
  ];

  // API health check
  await axios.get(`${API_URL}/api/health`, { timeout: 10000 });

  const results = [];
  for (const c of cases) {
    const literal = extractObjectLiteral(source, c.varName);
    const payload = parseObjectLiteral(literal);
    const result = await runOneCase(c.label, payload);
    results.push(result);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    apiUrl: API_URL,
    summary: {
      totalCases: results.length,
      passedCases: results.filter((r) => r.allPass).length,
      failedCases: results.filter((r) => !r.allPass).length,
      totalFields: results.reduce((sum, r) => sum + r.totalFields, 0),
      passedFields: results.reduce((sum, r) => sum + r.passedFields, 0)
    },
    cases: results
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));

  console.log(`Report written: ${OUTPUT_FILE}`);
  for (const r of results) {
    console.log(`${r.label}: ${r.passedFields}/${r.totalFields} fields matched (assessmentId: ${r.assessmentId})`);
  }
}

main().catch((err) => {
  console.error('Field-by-field basic report failed:', err.response?.data || err.message);
  process.exit(1);
});

