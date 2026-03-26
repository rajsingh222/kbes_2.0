const fs = require('fs');
const path = require('path');
const vm = require('vm');
const axios = require('axios');

const API = process.argv[2] || 'http://localhost:5000';
const FRONTEND_PAGES_DIR = path.resolve(__dirname, '../frontend/src/pages');
const BASIC_SOURCE = path.resolve(__dirname, 'test_basic_questionnaire_all_copy.js');
const OUT_FILE = path.resolve(__dirname, 'frontend_backend_key_hygiene_audit.json');

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

function extractObjectLiteralByMarker(source, marker) {
  const idx = source.indexOf(marker);
  if (idx < 0) return null;
  const open = source.indexOf('{', idx);
  if (open < 0) return null;
  const close = findMatchingBrace(source, open);
  if (close < 0) return null;
  return source.slice(open, close + 1);
}

function parseObjectLiteral(literal) {
  return vm.runInNewContext(`(${literal})`, {});
}

function extractBasicCases() {
  const source = fs.readFileSync(BASIC_SOURCE, 'utf8');
  const names = [
    ['RCC Basic', 'rcc'],
    ['Steel Basic', 'steel'],
    ['Composite Basic', 'composite'],
    ['Heritage Basic', 'heritage'],
    ['Load Bearing Basic', 'loadbearing']
  ];

  return names.map(([label, varName]) => {
    const marker = `const ${varName} = {`;
    const literal = extractObjectLiteralByMarker(source, marker);
    if (!literal) throw new Error(`Missing basic case "${varName}"`);
    return { label, payload: parseObjectLiteral(literal) };
  });
}

function extractDefaultStateKeysFromFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const literal = extractObjectLiteralByMarker(source, 'const defaultState = {');
  if (!literal) return [];
  const obj = parseObjectLiteral(literal);
  return Object.keys(obj);
}

function extractAdvancedHeritageKeys(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const keySet = new Set();
  const re = /\b(stateKey|otherField|usageTypeKey|usageTypeOther|masonryKey|masonryOtherKey|compositeMasonryKey|compositeMasonryOtherKey|mortarKey|elementsStateKey|typesStateKey|sourcesStateKey|observationsStateKey|conditionStateKey|earthquakeIntensityField|inputKey)\s*:\s*'([^']+)'/g;

  let m;
  while ((m = re.exec(source)) !== null) {
    const key = m[2];
    if (/^q\d+[a-z0-9_]*$/i.test(key) || /^adv_[a-z0-9_]+$/i.test(key)) {
      keySet.add(key);
    }
  }
  return Array.from(keySet).sort();
}

function valueForKey(key) {
  const k = key.toLowerCase();
  if (k.endsWith('_has') || k.includes('_has_') || k.includes('_mandated') || k.includes('_available') || k.includes('_adequate') || k.includes('_recommended') || k.includes('_exceeding_')) {
    return 'Yes';
  }
  if (k.includes('types') || k.includes('elements') || k.includes('sources') || k.includes('orientations') || k.includes('locations') || k.includes('observations') || k.includes('parameters') || k.includes('disasters') || k.includes('usage_type') || k.includes('loads')) {
    return [`AUDIT_${key}`];
  }
  if (k.includes('count') || k.includes('num_') || k.includes('_num') || k.includes('pct') || k.includes('max_') || k.includes('avg_')) {
    return '1';
  }
  return `AUDIT_${key}`;
}

function compareKeySets(expectedKeys, actualKeys) {
  const expected = new Set(expectedKeys);
  const actual = new Set(actualKeys);
  const missing = expectedKeys.filter((k) => !actual.has(k));
  const extra = actualKeys.filter((k) => !expected.has(k));
  return { missing, extra };
}

async function ensureUser(emailPrefix) {
  const email = `${emailPrefix}_${Date.now()}@osham.test`;
  const user = {
    firstName: 'Key',
    lastName: 'Audit',
    email,
    phone: '9876543210',
    password: 'TestPass@123',
    organisation: 'SPPL Key Audit',
    country: 'India'
  };
  await axios.post(`${API}/api/auth/register`, user);
  const login = await axios.post(`${API}/api/auth/login`, { email: user.email, password: user.password });
  return { user, token: login.data?.token, userId: login.data?.user?.id || null };
}

async function runBasicAudit(user) {
  const cases = extractBasicCases();
  const results = [];

  for (const c of cases) {
    const payload = JSON.parse(JSON.stringify(c.payload));
    payload.userDetails.email = user.email;
    payload.userDetails.name = `${user.firstName} ${user.lastName}`;
    payload.userDetails.phone = user.phone;
    payload.userDetails.organization = user.organisation;

    const save = await axios.post(`${API}/api/save-assessment`, {
      userDetails: payload.userDetails,
      assessmentResponses: payload.responses,
      assessmentType: 'Building'
    });
    const assessmentId = save.data?.assessmentId;
    const doc = (await axios.get(`${API}/api/assessment/${assessmentId}`)).data || {};

    const expectedKeys = Object.keys(payload.responses || {}).sort();
    const rawKeys = Object.keys(doc.assessmentResponses?.raw_responses || doc.assessmentResponses || {}).sort();
    const flatKeys = Object.keys(doc.responses || {}).sort();
    const rawCmp = compareKeySets(expectedKeys, rawKeys);
    const flatCmp = compareKeySets(expectedKeys, flatKeys);

    results.push({
      label: c.label,
      assessmentId,
      expectedCount: expectedKeys.length,
      rawCount: rawKeys.length,
      flatCount: flatKeys.length,
      rawMissingCount: rawCmp.missing.length,
      rawExtraCount: rawCmp.extra.length,
      flatMissingCount: flatCmp.missing.length,
      flatExtraCount: flatCmp.extra.length,
      rawMissingSample: rawCmp.missing.slice(0, 20),
      rawExtraSample: rawCmp.extra.slice(0, 20),
      flatMissingSample: flatCmp.missing.slice(0, 20),
      flatExtraSample: flatCmp.extra.slice(0, 20),
      allGood: rawCmp.missing.length === 0 && rawCmp.extra.length === 0 && flatCmp.missing.length === 0 && flatCmp.extra.length === 0
    });
  }
  return results;
}

async function createBaseAssessmentForAdvanced(user, structureType) {
  const raw = {
    q5_structural_system: structureType,
    q1_city: 'AuditCity',
    q1_country: 'India',
    q2_usage: 'Residential'
  };
  const res = await axios.post(`${API}/api/submit-assessment`, {
    userDetails: {
      name: `${user.firstName} ${user.lastName}`,
      email: user.email,
      phone: user.phone,
      organization: user.organisation,
      structureType,
      q1: 'Structural Engineer',
      yearOfConstruction: '10-20 years',
      location: 'AuditCity'
    },
    assessmentResponses: { raw_responses: raw, formatted_responses: {} },
    assessmentType: 'Building'
  });
  return res.data?.assessmentId;
}

async function runAdvancedAudit(token, user) {
  const files = [
    {
      label: 'Advanced RCC',
      file: path.resolve(FRONTEND_PAGES_DIR, 'AdvancedRCCAssessment.js'),
      structureType: 'RCC Structure',
      formVersion: 'advanced-rcc-v1'
    },
    {
      label: 'Advanced Steel',
      file: path.resolve(FRONTEND_PAGES_DIR, 'AdvancedSteelAssessment.js'),
      structureType: 'Steel Structure',
      formVersion: 'advanced-steel-v1'
    },
    {
      label: 'Advanced Composite',
      file: path.resolve(FRONTEND_PAGES_DIR, 'AdvancedCompositeAssessment.js'),
      structureType: 'Composite Structure (RCC + Steel)',
      formVersion: 'advanced-composite-v1'
    },
    {
      label: 'Advanced Load Bearing',
      file: path.resolve(FRONTEND_PAGES_DIR, 'AdvancedLoadBearingAssessment.js'),
      structureType: 'Load Bearing Masonry',
      formVersion: 'advanced-lb-v1'
    },
    {
      label: 'Advanced Heritage',
      file: path.resolve(FRONTEND_PAGES_DIR, 'AdvancedHeritageAssessment.js'),
      structureType: 'Heritage Structure',
      formVersion: 'advanced-heritage-v1',
      heritageRegexMode: true
    }
  ];

  const results = [];

  for (const f of files) {
    const keys = f.heritageRegexMode
      ? extractAdvancedHeritageKeys(f.file)
      : extractDefaultStateKeysFromFile(f.file);

    const payload = {};
    keys.forEach((k) => {
      payload[k] = valueForKey(k);
    });
    payload._meta = {
      structureType: f.structureType,
      submittedAt: new Date().toISOString(),
      formVersion: f.formVersion
    };

    const assessmentId = await createBaseAssessmentForAdvanced(user, f.structureType);
    await axios.post(
      `${API}/api/assessment/${assessmentId}/advanced`,
      { advancedResponses: payload },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const doc = (await axios.get(`${API}/api/assessment/${assessmentId}`)).data || {};
    const savedKeys = Object.keys(doc.advancedResponses || {}).sort();
    const expectedKeys = Object.keys(payload).filter((k) => k !== '_meta').sort();
    const cmp = compareKeySets(expectedKeys, savedKeys);

    results.push({
      label: f.label,
      assessmentId,
      expectedCount: expectedKeys.length,
      savedCount: savedKeys.length,
      missingCount: cmp.missing.length,
      extraCount: cmp.extra.length,
      missingSample: cmp.missing.slice(0, 20),
      extraSample: cmp.extra.slice(0, 20),
      allGood: cmp.missing.length === 0 && cmp.extra.length === 0
    });
  }

  return results;
}

async function main() {
  await axios.get(`${API}/api/health`, { timeout: 10000 });
  const { user, token, userId } = await ensureUser('frontend_backend_keys');

  const basicResults = await runBasicAudit(user);
  const advancedResults = await runAdvancedAudit(token, user);

  const allResults = [...basicResults, ...advancedResults];
  const report = {
    generatedAt: new Date().toISOString(),
    api: API,
    user: {
      email: user.email,
      userId
    },
    summary: {
      checks: allResults.length,
      passed: allResults.filter((r) => r.allGood).length,
      failed: allResults.filter((r) => !r.allGood).length
    },
    basic: basicResults,
    advanced: advancedResults
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error('Key hygiene audit failed:', err.response?.data || err.message);
  process.exit(1);
});

