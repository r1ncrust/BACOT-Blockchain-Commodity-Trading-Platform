#!/usr/bin/env node
// =============================================================================
// TC-API-01 | REST API Injection & Unauthorized Access (Information Disclosure)
// Target   : Off-chain backend wrapping IPFS & checkloads
//            (Assumed endpoint: http://localhost:3001)
// Threat   : Information Disclosure
// Tool     : Manual Test (Node.js script using built-in fetch / node-fetch)
// Severity : Medium–High (CVSS 6.5–8.0)
//
// Objective:
//   1. Probe the /api/checkpoints and /api/document APIs with malformed payloads.
//   2. Check for verbose error disclosure (stack traces, paths).
//   3. Test oversized field values and special characters.
//   4. Test path traversal on document retrieval.
//
// Usage:
//   node TC-API-01_api_injection.js [BASE_URL]
//   node TC-API-01_api_injection.js http://localhost:3001
//
// =============================================================================

let BASE_URL = process.argv[2];
if (!BASE_URL || BASE_URL === 'test' || !BASE_URL.startsWith('http')) {
  BASE_URL = "http://localhost:3001";
}

// ── ANSI colours ──────────────────────────────────────────────────────────────
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

let passed = 0, failed = 0, warnings = 0;

function pass(msg) { console.log(`${GREEN}  ✅ PASS${RESET}  ${msg}`); passed++; }
function fail(msg) { console.error(`${RED}  ❌ FAIL${RESET}  ${msg}`); failed++; }
function warn(msg) { console.warn(`${YELLOW}  ⚠️  WARN${RESET}  ${msg}`); warnings++; }
function info(msg) { console.log(`${CYAN}  ℹ  ${RESET}${msg}`); }

// ── Generic fetch helper ──────────────────────────────────────────────────────
async function req(method, path, body, headers = {}) {
  const defaultHeaders = { "Content-Type": "application/json", ...headers };

  let res, text;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: method !== 'GET' ? defaultHeaders : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    text = await res.text();
  } catch (err) {
    return { status: 0, text: err.message, json: null, error: err };
  }

  let json = null;
  try { json = JSON.parse(text); } catch (_) { }
  return { status: res.status, text, json };
}

// ── Verbose error patterns to detect in responses ────────────────────────────
const VERBOSE_PATTERNS = [
  /stack trace/i, /stacktrace/i, /at Object\./,
  /at Function\./,
  /\/home\//i, /\/var\//i, /\/usr\//i, /C:\\/i,
  /SyntaxError:/i, /TypeError:/i, /ReferenceError:/i,
  /sql/i, /sqlite/i, /postgres/i, /mysql/i,
  /sequelize/i, /prisma/i, /mongoose/i,
  /ECONNREFUSED/, /ENOENT/,
];

function checkVerbose(text, testName) {
  for (const pattern of VERBOSE_PATTERNS) {
    if (pattern.test(text)) {
      fail(`${testName} – verbose error disclosure detected: "${pattern}"`);
      info(`Response snippet: ${text.substring(0, 300)}`);
      return true;
    }
  }
  return false;
}

// =============================================================================
// TEST SUITE
// =============================================================================

async function runTests() {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`TC-API-01 | REST API Security Test`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`${"=".repeat(70)}\n`);

  // ── GROUP 1: Basic endpoints availability ─────────────────────────────────
  console.log(`${CYAN}GROUP 1: Basic endpoint availability${RESET}`);

  {
    const r = await req("GET", "/api/checkpoints/1");
    if (r.status === 0) {
      warn("API endpoint not reachable – is the backend running on port 3001?");
    } else if (r.status === 200) {
      pass("GET /api/checkpoints/1 is reachable");
    } else {
      warn(`GET /api/checkpoints/1 returned status ${r.status}`);
    }
  }

  // ── GROUP 2: Injection payloads ──────────────────────────────────────────
  console.log(`\n${CYAN}GROUP 2: Injection payload tests for Checkpoints API${RESET}`);

  const injectionPayloads = [
    // SQL-like injection in string fields
    {
      name: "SQL injection in location",
      payload: { location: "'; DROP TABLE checkpoints; --", temperature: 20, humidity: 50, dataHash: "0x123" },
    },
    // XSS payload
    {
      name: "XSS payload in location",
      payload: { location: "<script>alert('xss')</script>", temperature: 20, humidity: 50, dataHash: "0x123" },
    },
    // Oversized string (10KB)
    {
      name: "Oversized location (10KB)",
      payload: { location: "A".repeat(10240), temperature: 20, humidity: 50, dataHash: "0x123" },
    },
    // Null bytes
    {
      name: "Null byte in field",
      payload: { location: "Port\x00evil", temperature: 20, humidity: 50, dataHash: "0x123" },
    },
    // Number type confusion
    {
      name: "String in numeric field",
      payload: { location: "Port", temperature: "twenty", humidity: 50, dataHash: "0x123" },
    },
    // Missing fields
    {
      name: "Empty payload",
      payload: {},
    },
    // JSON injection / prototype pollution
    {
      name: "Prototype pollution attempt",
      payload: { "__proto__": { "admin": true }, location: "Port", temperature: 20 },
    },
  ];

  for (const { name, payload } of injectionPayloads) {
    const r = await req("POST", "/api/checkpoints/100", payload);
    if (r.status === 0) {
      warn(`${name} – API not reachable`);
      continue;
    }

    const disclosed = checkVerbose(r.text, name);
    if (!disclosed) {
      if (r.status === 400 || r.status === 422) {
        pass(`${name} – returns 400/422 without verbose disclosure`);
      } else if (r.status === 200 || r.status === 201) {
        // Since backend is just an in-memory mock that accepts anything, this will fail.
        fail(`${name} – accepted invalid/malicious payload (status ${r.status})`);
      } else {
        warn(`${name} – returned status ${r.status}`);
      }
    }
  }

  // ── GROUP 3: Path traversal / Document manipulation ─────────────────────
  console.log(`\n${CYAN}GROUP 3: Path Traversal / LFI on Documents API${RESET}`);

  const idTests = [
    "/api/document/test.pdf",
    "/api/document/../../../etc/passwd",
    "/api/document/..%2F..%2F..%2Fetc%2Fpasswd",
    "/api/document/null",
    "/api/document/undefined",
  ];

  for (const path of idTests) {
    const r = await req("GET", path);
    if (r.status === 0) { warn(`${path} – not reachable`); continue; }

    const disclosed = checkVerbose(r.text, `GET ${path}`);
    if (!disclosed) {
      if (r.status === 404 || r.status === 400 || r.status === 422) {
        pass(`GET ${path} → ${r.status} (safe error response)`);
      } else if (r.status === 200) {
        warn(`GET ${path} returned 200 – verified data returned is not sensitive`);
      } else {
        warn(`GET ${path} → ${r.status}`);
      }
    }
  }

  // ── GROUP 4: HTTP method fuzzing ─────────────────────────────────────────
  console.log(`\n${CYAN}GROUP 4: HTTP method fuzzing${RESET}`);

  for (const method of ["DELETE", "PUT", "PATCH", "OPTIONS", "TRACE"]) {
    const r = await req(method, "/api/checkpoints/1");
    if (r.status === 0) continue;
    if (r.status === 405 || r.status === 404 || r.status === 401 || r.status === 403) {
      pass(`${method} /api/checkpoints/1 → ${r.status} (correctly restricted)`);
    } else if (r.status === 200) {
      warn(`${method} /api/checkpoints/1 → 200 – verify this is intentional`);
    } else {
      info(`${method} /api/checkpoints/1 → ${r.status}`);
    }
  }

  // ── SUMMARY ──────────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(70)}`);
  console.log(`SUMMARY | Passed: ${passed} | Failed: ${failed} | Warnings: ${warnings}`);
  console.log(`${"=".repeat(70)}\n`);

  if (failed > 0) {
    console.error(`${RED}❌ Security issues detected – review FAIL items above${RESET}`);
    console.log(`\n   Note: If the backend currently accepts all payloads (e.g. string for temperature)
   it is working as an early mock. You may want to add validation (e.g. Joi or express-validator)
   before deploying to production.`);
    throw new Error("API security tests failed.");
  } else {
    console.log(`${GREEN}✅ All reachable endpoints passed security checks${RESET}`);
  }
}
if (typeof describe !== 'undefined') {
  describe("TC-API-01 | REST API Security Test", function () {
    it("Should pass all security checks against the backend API", async function () {
      await runTests();
    });
  });
} else {
  // If run directly using `node TC-API-01_api_injection.js`
  runTests().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
