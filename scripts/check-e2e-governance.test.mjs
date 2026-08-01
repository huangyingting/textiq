import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { load as parseYaml } from "js-yaml";

import { scanGovernance, scanText } from "./check-e2e-governance.mjs";
import { createTestFixtureRoot } from "./test-fixtures.mjs";

function credentialSanitizerFixture() {
  return [
    "const CREDENTIAL_HEADER_NAMES = new Set();",
    "const CREDENTIAL_HEADER_PATTERN = /token/;",
    "function isPlainObject(value) { return value !== null; }",
    "function sanitizeCredentialFreeHeaders(headers) { if (CREDENTIAL_HEADER_NAMES.has('authorization') || CREDENTIAL_HEADER_PATTERN.test('token')) throw new Error('credential'); return headers; }",
    "function sanitizeCredentialGatedOptions(options) { if (options === undefined) return options; if (!isPlainObject(options)) { throw new Error('options'); } return { ...options, headers: sanitizeCredentialFreeHeaders(options.headers) }; }",
  ];
}

function markdownFilesUnder(root) {
  const files = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...markdownFilesUnder(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
}

function runnableProfileCommands(markdown) {
  const commands = [];

  for (const match of markdown.matchAll(/```(?:bash|sh)\r?\n([\s\S]*?)```/g)) {
    const block = match[1].replace(/\\\r?\n[ \t]*/g, " ");
    for (const line of block.split(/\r?\n/)) {
      const command = line.trim();
      if (!command || command.startsWith("#")) continue;
      if (
        /\bnpm\s+run\s+test:e2e:profile(?::self-contained)?(?:\s|$)/.test(
          command,
        ) ||
        /(?:^|\s)E2E_PROFILE=1(?:\s|$)/.test(command)
      ) {
        commands.push(command);
      }
    }
  }

  return commands;
}

function shellAssignments(command) {
  return Object.fromEntries(
    [...command.matchAll(/(?:^|\s)([A-Z][A-Z0-9_]*)=([^\s]+)/g)].map(
      ([, name, value]) => [name, value.replace(/^(['"])(.*)\1$/, "$2")],
    ),
  );
}

function isExactImplicitProfileWrapper(command) {
  return command === "npm run test:e2e:profile";
}

test("e2e governance: deterministic workflows use the canonical localhost origin", () => {
  const workflowRoot = join(process.cwd(), ".github", "workflows");
  const profileSteps = [];

  for (const fileName of readdirSync(workflowRoot)) {
    if (!/\.ya?ml$/.test(fileName)) continue;
    const workflow = parseYaml(
      readFileSync(join(workflowRoot, fileName), "utf8"),
    );

    for (const [jobName, job] of Object.entries(workflow?.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        if (
          typeof step?.run !== "string" ||
          !/\bnpm\s+run\s+test:e2e:profile(?::self-contained)?(?:\s|$)/.test(
            step.run,
          )
        ) {
          continue;
        }

        profileSteps.push(`${fileName}:${jobName}:${step.name ?? "unnamed"}`);
        assert.doesNotMatch(
          step.run,
          /\b(?:E2E_BASE_URL|BASE_URL|AUTH_URL)\s*=/,
        );
        const env = {
          ...(workflow.env ?? {}),
          ...(job.env ?? {}),
          ...(step.env ?? {}),
        };

        assert.match(String(env.PORT ?? ""), /^[1-9]\d*$/);
        // The runtime derives a per-run r-<hash>.localhost hostname from
        // E2E_PROFILE_RUN_ID + E2E_PROFILE_RUN_NONCE. Static URL env vars
        // must NOT be set — if present they suppress derivation and are then
        // rejected by validateProfileHostname as "not per-run".
        assert.equal(
          env.E2E_BASE_URL,
          undefined,
          `${fileName}:${jobName} must not set a static E2E_BASE_URL`,
        );
        for (const name of ["BASE_URL", "AUTH_URL"]) {
          assert.equal(
            env[name],
            undefined,
            `${fileName}:${jobName} must not set a static ${name}`,
          );
        }
      }
    }
  }

  assert.ok(
    profileSteps.length > 0,
    "No active deterministic profile step found",
  );
});

test("e2e governance: runnable profile docs leave static URL env vars unset", () => {
  const profileCommands = [];

  for (const rootName of ["docs", "e2e"]) {
    const root = join(process.cwd(), rootName);
    for (const filePath of markdownFilesUnder(root)) {
      for (const command of runnableProfileCommands(
        readFileSync(filePath, "utf8"),
      )) {
        profileCommands.push({ filePath, command });
      }
    }
  }

  assert.ok(
    profileCommands.length > 0,
    "No runnable deterministic profile docs found",
  );
  for (const { filePath, command } of profileCommands) {
    const env = shellAssignments(command);
    const label = `${filePath}: ${command}`;

    if (env.E2E_PROFILE === undefined) {
      assert.equal(isExactImplicitProfileWrapper(command), true, label);
    } else {
      assert.equal(env.E2E_PROFILE, "1", label);
    }
    for (const name of ["E2E_BASE_URL", "BASE_URL", "AUTH_URL"]) {
      assert.equal(
        env[name],
        undefined,
        `${label} must not set a static ${name}`,
      );
    }
  }
});

test("e2e governance: only the exact self-contained wrapper implies the profile env", () => {
  assert.equal(isExactImplicitProfileWrapper("npm run test:e2e:profile"), true);
  for (const command of [
    "npm run test:e2e:profile -- e2e/example.spec.ts",
    "npm run test:e2e:profile:self-contained",
    "npx playwright test",
    "sudo npm run test:e2e:profile",
  ]) {
    assert.equal(isExactImplicitProfileWrapper(command), false, command);
  }
});

test("e2e governance: flags unapproved raw sleeps", () => {
  const findings = scanText(
    "e2e/example.spec.ts",
    "await page.waitForTimeout(500);",
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "wait-for-timeout");
});

test("e2e governance: rejects browser activation workarounds", () => {
  const cases = [
    ["await button.click({ force: true });", "forced-click"],
    [
      "await button.evaluate((element) => element.click());",
      "dom-click-evaluate",
    ],
    ["document.querySelector('button')?.click();", "direct-dom-click"],
    ["element.dispatchEvent(new MouseEvent('click'));", "dispatch-event"],
  ];

  for (const [source, rule] of cases) {
    assert.ok(
      scanText("e2e/example.spec.ts", source).some(
        (item) => item.rule === rule,
      ),
      source,
    );
  }
});

test("e2e governance: accepts explicitly allowed browser event dispatch", () => {
  const findings = scanText(
    "e2e/example.spec.ts",
    [
      "// e2e-governance-allow dispatch-event: direct dispatch is required to inspect cancellation.",
      "element.dispatchEvent(new KeyboardEvent('keydown'));",
    ].join("\n"),
  );

  assert.deepEqual(findings, []);
});

test("e2e governance: accepts real Playwright pointer and keyboard activation", () => {
  assert.deepEqual(
    scanText(
      "e2e/example.spec.ts",
      [
        "await button.click();",
        "await button.press('Enter');",
        "await page.keyboard.press('Space');",
      ].join("\n"),
    ),
    [],
  );
});

test("e2e governance: rejects fixed sleeps in the route-client regression suite", () => {
  const findings = scanText(
    "src/app/app/documents/[id]/slides/slide-editor-route-client.test.tsx",
    "await new Promise((resolve) => setTimeout(resolve, 1700));",
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "fixed-test-sleep");
});

test("e2e governance: accepts explicitly allowed skips", () => {
  const findings = scanText(
    "e2e/example.spec.ts",
    [
      "// e2e-governance-allow test-skip: profile tests skip without seed.",
      'test.skip(!seeded, "seed required");',
    ].join("\n"),
  );

  assert.deepEqual(findings, []);
});

test("e2e governance: flags local deck fixture factories in high-risk files", () => {
  const findings = scanText(
    "e2e/presentation/slides-layout-screenshots.spec.ts",
    "function makeDeck() { return {}; }",
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "local-fixture-factory");
});

test("e2e governance: flags oversized tests outside the allowlist", () => {
  const findings = scanText(
    "src/lib/example.test.ts",
    Array.from({ length: 1_501 }, (_, index) => `// ${index}`).join("\n"),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "oversized-test");
});

test("e2e governance: accepts file-level oversized test allow comments", () => {
  const findings = scanText(
    "src/lib/example.test.ts",
    [
      "// e2e-governance-allow oversized-test: broad export matrix stays together until shared fixtures are extracted.",
      ...Array.from({ length: 1_501 }, (_, index) => `// ${index}`),
    ].join("\n"),
  );

  assert.deepEqual(findings, []);
});

test("e2e governance: accepts profile-gated skips", () => {
  assert.deepEqual(
    scanText(
      "e2e/example.spec.ts",
      'test.skip(!process.env.E2E_PROFILE, "profile required");\n',
    ),
    [],
  );
});

test("e2e governance: rejects raw authenticated Playwright request context bypasses", () => {
  for (const source of [
    "await page.request.post('/api/import', { data: secret });",
    "await request.get('/api/private');",
    "await request?.['get']('/api/private');",
    "const api = context.request;",
    "const api = request;",
    "const api = context['request'];",
    "const key = 'request'; const api = context[key];",
    "const { request: api } = fixtures;",
    "const { ['request']: api } = fixtures;",
    "test('x', async ({ request: api }) => api.get('/private'));",
    "import { request as api } from '@playwright/test';",
    "const api = Reflect.get(page, 'request');",
    "const send = page.request.post.bind(page.request);",
    "const send = request['post'].bind(request);",
    "let api: APIRequestContext;",
  ]) {
    const findings = scanText("e2e/example.spec.ts", source);
    assert.ok(
      findings.some((item) => item.rule === "raw-api-request-context"),
      source,
    );
  }
});

test("e2e governance: accepts gated and explicitly unauthenticated request facades", () => {
  assert.deepEqual(
    scanText(
      "e2e/example.spec.ts",
      [
        "await credentialGatedRequest(page).post('/api/import', { data });",
        "await unauthenticatedRequest().get('/ready');",
        "const routeRequest = route.request();",
      ].join("\n"),
    ),
    [],
  );
});

test("e2e governance: rejects direct and indirect fetch bypasses", () => {
  for (const source of [
    "await fetch('/api/private', { headers });",
    "await globalThis.fetch('/api/private');",
    "await window['fetch']('/api/private');",
    "const send = globalThis.fetch.bind(globalThis);",
    "const send = Reflect.get(globalThis, 'fetch');",
    "const key = 'fetch'; const root = globalThis; const send = (root as any)[key];",
    "const send = Reflect['get'](globalThis, 'fetch');",
    "const { fetch: send } = globalThis;",
    "const send = fetch;",
  ]) {
    const findings = scanText("e2e/example.spec.ts", source);
    assert.ok(
      findings.some((item) => item.rule === "raw-e2e-fetch"),
      source,
    );
  }
});

test("e2e governance: rejects node clients and curl or wget subprocesses", () => {
  const cases = [
    ["import * as http from 'node:http';", "raw-e2e-network-client"],
    ["const https = require('https');", "raw-e2e-network-client"],
    ["const undici = await import('undici');", "raw-e2e-network-client"],
    [
      "import { exec } from 'node:child_process'; exec('curl http://host/private');",
      "raw-e2e-shell-network",
    ],
    [
      "import { spawn as run } from 'node:child_process'; run('wget', ['http://host/private']);",
      "raw-e2e-shell-network",
    ],
    [
      "import * as cp from 'node:child_process'; const run = cp['spawn'].bind(cp); run('curl', ['http://host/private']);",
      "raw-e2e-shell-network",
    ],
  ];
  for (const [source, rule] of cases) {
    assert.ok(
      scanText("e2e/example.spec.ts", source).some(
        (item) => item.rule === rule,
      ),
      source,
    );
  }
});

test("e2e governance: narrowly permits the named hostile HTTP listener attack harness", () => {
  const approvedSource = [
    "import { createServer, type Server } from 'node:http';",
    "async function listenHostile(host: string): Promise<Server> {",
    "  const server = createServer((_request, response) => response.end('hostile'));",
    "  server.listen(0, host);",
    "  return server;",
    "}",
  ].join("\n");
  assert.deepEqual(
    scanText("e2e/auth/authenticated-nested-routes.spec.ts", approvedSource),
    [],
  );

  for (const [filePath, source] of [
    ["e2e/other.spec.ts", approvedSource],
    [
      "e2e/auth/authenticated-nested-routes.spec.ts",
      approvedSource.replace("listenHostile", "listenNormally"),
    ],
    [
      "e2e/auth/authenticated-nested-routes.spec.ts",
      `${approvedSource}\ncreateServer(() => undefined);`,
    ],
  ]) {
    assert.ok(
      scanText(filePath, source).some(
        (item) => item.rule === "raw-e2e-network-client",
      ),
      `${filePath}: ${source}`,
    );
  }
});

test("e2e governance: rejects adversarial capability dataflow bypasses", () => {
  const cases = [
    ["process.getBuiltinModule('node:http');", "raw-e2e-network-client"],
    ["const pick = Reflect.get; pick(globalThis, 'fetch');", "raw-e2e-fetch"],
    ["let send; send = fetch; send('/private');", "raw-e2e-fetch"],
    ["send = fetch; send('/private');", "raw-e2e-fetch"],
    [
      "const childProcess = process.getBuiltinModule('node:child_process'); Reflect.get(childProcess, 'spawn')('curl', ['http://host/private']);",
      "raw-e2e-shell-network",
    ],
    [
      "const root = globalThis; const first = root.fetch; const second = first; second('/private');",
      "raw-e2e-fetch",
    ],
    [
      "let send = () => undefined; send = window.fetch; send('/private');",
      "raw-e2e-fetch",
    ],
    ["const { fetch: send } = globalThis; send('/private');", "raw-e2e-fetch"],
    [
      "let send; ({ ['fetch']: send } = globalThis); send('/private');",
      "raw-e2e-fetch",
    ],
    ["globalThis?.['fetch']?.('/private');", "raw-e2e-fetch"],
    [
      "import { createRequire as makeRequire } from 'node:module'; const load = makeRequire(import.meta.url); load('node:https');",
      "raw-e2e-network-client",
    ],
    [
      "const makeRequire = module.createRequire; const load = makeRequire(import.meta.url); load('node:http2');",
      "raw-e2e-network-client",
    ],
    [
      "const load = process.getBuiltinModule.bind(process); load('node:net');",
      "raw-e2e-network-client",
    ],
    [
      "const { get: pick } = Reflect; const send = pick(window, 'fetch'); send('/private');",
      "raw-e2e-fetch",
    ],
    [
      "const cp = process.getBuiltinModule('node:child_process'); const { spawn: run } = cp; run(command, args);",
      "raw-e2e-shell-network",
    ],
    [
      "const cp = process.getBuiltinModule('node:child_process'); let run; ({ spawn: run } = cp); run(command, args);",
      "raw-e2e-shell-network",
    ],
    [
      "const cp = process.getBuiltinModule('node:child_process'); cp['sp' + 'awn']?.(command, ['--dynamic', target]);",
      "raw-e2e-shell-network",
    ],
    [
      "const load = () => process.getBuiltinModule('node:tls'); load().connect(options);",
      "raw-e2e-network-client",
    ],
    [
      "const cp = process.getBuiltinModule('node:child_process'); function runner() { return Reflect.get(cp, 'fork'); } runner()(dynamicModule, dynamicArgs);",
      "raw-e2e-shell-network",
    ],
    [
      "const cp = process.getBuiltinModule('node:child_process'); const pick = (target, key) => Reflect.get(target, key); pick(cp, 'execFile')(dynamicCommand, dynamicArgs);",
      "raw-e2e-shell-network",
    ],
    [
      "function load(name) { return process.getBuiltinModule(name); } load('node:https').request(options);",
      "raw-e2e-network-client",
    ],
    [
      "const load = await import('node:undici'); load.request('/private');",
      "raw-e2e-network-client",
    ],
    [
      "let load; load = require; const client = load('node:http'); client.get('/private');",
      "raw-e2e-network-client",
    ],
  ];

  for (const [source, rule] of cases) {
    assert.ok(
      scanText("e2e/adversarial.spec.ts", source).some(
        (item) => item.rule === rule,
      ),
      source,
    );
  }

  const literalCommand = scanText(
    "e2e/adversarial.spec.ts",
    "const cp = process.getBuiltinModule('node:child_process'); cp.spawn('curl', ['--fail', target]);",
  ).find((item) => item.rule === "raw-e2e-shell-network");
  assert.match(literalCommand?.match ?? "", /^curl via /);
});

test("e2e governance: respects lexical shadowing of capability names", () => {
  const findings = scanText(
    "e2e/shadowed.spec.ts",
    [
      "function local(fetch, Reflect, process, require, request) {",
      "  fetch('/local');",
      "  Reflect.get({ value: 1 }, 'value');",
      "  process.getBuiltinModule('node:http');",
      "  require('node:https');",
      "  request.get('/local');",
      "}",
      "const window = { fetch() {} };",
      "window.fetch('/local');",
      "const childProcess = { spawn() {} };",
      "childProcess.spawn('curl');",
      "try { throw new Error('local'); } catch (fetch) { fetch('/local'); }",
    ].join("\n"),
  );

  assert.deepEqual(findings, []);
});

test("e2e governance: limits block-scoped shadows to their true scopes", () => {
  const cases = [
    [
      [
        "{",
        "  const fetch = () => undefined;",
        "  fetch('/local');",
        "}",
        "fetch('/private');",
      ].join("\n"),
      5,
    ],
    [
      [
        "function nested() {",
        "  {",
        "    const fetch = () => undefined;",
        "    fetch('/local');",
        "  }",
        "  fetch('/private');",
        "}",
      ].join("\n"),
      6,
    ],
    [
      [
        "class Example {",
        "  static {",
        "    const fetch = () => undefined;",
        "    fetch('/local');",
        "  }",
        "}",
        "fetch('/private');",
      ].join("\n"),
      7,
    ],
    [
      [
        "class Example {",
        "  static {",
        "    var fetch = () => undefined;",
        "    fetch('/local');",
        "  }",
        "}",
        "fetch('/private');",
      ].join("\n"),
      7,
    ],
    [["{", "  class fetch {}", "}", "fetch('/private');"].join("\n"), 4],
    [
      [
        "try {",
        "  throw undefined;",
        "} catch (fetch) {",
        "  fetch('/local');",
        "}",
        "fetch('/private');",
      ].join("\n"),
      6,
    ],
  ];

  for (const [source, expectedLine] of cases) {
    const fetchFindings = scanText("e2e/scopes.spec.ts", source).filter(
      (item) => item.rule === "raw-e2e-fetch",
    );
    assert.deepEqual(
      fetchFindings.map((item) => item.lineNumber),
      [expectedLine],
      source,
    );
  }
});

test("e2e governance: scopes for-loop lexical declarations to each loop", () => {
  const cases = [
    [
      [
        "const local = () => undefined;",
        "for (let fetch = local; false; ) { fetch('/local'); }",
        "fetch('/private');",
      ].join("\n"),
      3,
    ],
    [
      ["for (let fetch in {}) { fetch('/local'); }", "fetch('/private');"].join(
        "\n",
      ),
      2,
    ],
    [
      [
        "const local = () => undefined;",
        "for (let fetch of [local]) { fetch('/local'); }",
        "fetch('/private');",
      ].join("\n"),
      3,
    ],
  ];

  for (const [source, expectedLine] of cases) {
    const fetchFindings = scanText("e2e/loops.spec.ts", source).filter(
      (item) => item.rule === "raw-e2e-fetch",
    );
    assert.deepEqual(
      fetchFindings.map((item) => item.lineNumber),
      [expectedLine],
      source,
    );
  }
});

test("e2e governance: gives switch cases one shared lexical scope", () => {
  const source = [
    "switch (mode) {",
    "  case 0:",
    "    const fetch = () => undefined;",
    "    break;",
    "  case 1:",
    "    fetch('/local');",
    "}",
    "fetch('/private');",
  ].join("\n");

  const fetchFindings = scanText("e2e/switch.spec.ts", source).filter(
    (item) => item.rule === "raw-e2e-fetch",
  );
  assert.deepEqual(
    fetchFindings.map((item) => item.lineNumber),
    [8],
  );
});

test("e2e governance: keeps var declarations function or program scoped", () => {
  for (const source of [
    ["{", "  var fetch = () => undefined;", "}", "fetch('/local');"].join("\n"),
    ["for (var fetch = () => undefined; false; ) {}", "fetch('/local');"].join(
      "\n",
    ),
    [
      "function local() {",
      "  if (true) { var fetch = () => undefined; }",
      "  fetch('/local');",
      "}",
    ].join("\n"),
    [
      "switch (mode) {",
      "  case 0:",
      "    var fetch = () => undefined;",
      "}",
      "fetch('/local');",
    ].join("\n"),
  ]) {
    assert.deepEqual(scanText("e2e/var-scopes.spec.ts", source), [], source);
  }
});

test("e2e governance: propagates outer assignments without leaking inner bindings", () => {
  const outerAssignment = scanText(
    "e2e/outer-assignment.spec.ts",
    ["let send;", "{", "  send = fetch;", "}", "send('/private');"].join("\n"),
  );
  assert.ok(
    outerAssignment.some(
      (item) => item.rule === "raw-e2e-fetch" && item.lineNumber === 5,
    ),
  );

  const innerShadow = scanText(
    "e2e/inner-shadow.spec.ts",
    [
      "let send = () => undefined;",
      "{",
      "  let send;",
      "  send = fetch;",
      "}",
      "send('/local');",
    ].join("\n"),
  );
  assert.ok(innerShadow.some((item) => item.rule === "raw-e2e-fetch"));
  assert.ok(
    !innerShadow.some(
      (item) => item.rule === "raw-e2e-fetch" && item.lineNumber === 6,
    ),
  );
});

test("e2e governance: detects reflected and prototype-mediated calls", () => {
  const cases = [
    "Reflect.apply(fetch, globalThis, ['/private']);",
    "const invoke = Reflect.apply; invoke(fetch, globalThis, ['/private']);",
    "const invoke = Reflect.apply.bind(Reflect); invoke(fetch, globalThis, ['/private']);",
    "fetch.call(globalThis, '/private');",
    "fetch.apply(globalThis, ['/private']);",
    "function invoke(fn) { fn('/private'); } Reflect.apply(invoke, undefined, [fetch]);",
    "function invoke(fn) { fn('/private'); } invoke.call(undefined, fetch);",
    "function invoke(fn) { fn('/private'); } invoke.apply(undefined, [fetch]);",
  ];

  for (const source of cases) {
    assert.ok(
      scanText("e2e/reflected.spec.ts", source).some(
        (item) => item.rule === "raw-e2e-fetch",
      ),
      source,
    );
  }

  const shellFinding = scanText(
    "e2e/reflected-shell.spec.ts",
    [
      "const cp = process.getBuiltinModule('node:child_process');",
      "Reflect.apply(cp.spawn, cp, ['curl', '--fail', target]);",
    ].join("\n"),
  ).find(
    (item) =>
      item.rule === "raw-e2e-shell-network" &&
      item.match.startsWith("curl via Reflect.apply"),
  );
  assert.ok(shellFinding);

  const networkFinding = scanText(
    "e2e/reflected-network.spec.ts",
    "Reflect.apply(require, undefined, ['node:https']);",
  ).find(
    (item) =>
      item.rule === "raw-e2e-network-client" &&
      item.match.startsWith("Reflect.apply"),
  );
  assert.ok(networkFinding);

  assert.deepEqual(
    scanText(
      "e2e/safe-reflected.spec.ts",
      [
        "function local(fetch) {",
        "  Reflect.apply(fetch, undefined, ['/local']);",
        "}",
      ].join("\n"),
    ),
    [],
  );
});

test("e2e governance: propagates capabilities through reflected argument arrays", () => {
  const cases = [
    "const args = [fetch]; Reflect.apply(invoke, null, args);",
    "const args = [fetch]; invoke.apply(null, args);",
    "const args = [fetch]; const alias = args; invoke.apply(null, alias);",
    "let args = [local]; args = [fetch]; invoke.apply(null, args);",
    "let args; args = [fetch]; Reflect.apply(invoke, null, args);",
    "const args = [fetch]; const spread = [...args]; invoke.apply(null, spread);",
    "const args = [local]; args[0] = fetch; invoke.apply(null, args);",
    "const args = [fetch]; const [send] = args; send('/private');",
    "const args = [fetch]; let send; [send] = args; send('/private');",
    "const args = [fetch]; args[0]('/private');",
    "const args = [fetch]; const index = 0; args[index]('/private');",
    "const args = [local]; const index = 0; args[index] = fetch; Reflect.apply(invoke, null, args);",
    "let send = local; const args = [local]; args[0] = send; send = fetch; Reflect.apply(invoke, null, args);",
    "const args = [local]; args[index] = fetch; Reflect.apply(invoke, null, args);",
    "const args = [local]; const alias = args; alias[0] = fetch; Reflect.apply(invoke, null, args);",
    "const args = [local]; args[index] = fetch; const [send] = args; send('/private');",
  ];

  for (const body of cases) {
    const source = [
      "const local = () => undefined;",
      "function invoke(fn) { fn('/private'); }",
      body,
    ].join("\n");
    assert.ok(
      scanText("e2e/reflected-array.spec.ts", source).some(
        (item) => item.rule === "raw-e2e-fetch",
      ),
      body,
    );
  }

  assert.deepEqual(
    scanText(
      "e2e/safe-reflected-array.spec.ts",
      [
        "const local = () => undefined;",
        "function invoke(fn) { fn('/local'); }",
        "const args = [local];",
        "const alias = [...args];",
        "Reflect.apply(invoke, null, alias);",
        "invoke.apply(null, alias);",
      ].join("\n"),
    ),
    [],
  );
});

test("e2e governance: approves every hardwired credential facade method", () => {
  for (const method of [
    "delete",
    "fetch",
    "get",
    "head",
    "patch",
    "post",
    "put",
  ]) {
    const source = [
      "import { assertProfileCredentialGate } from './profile-credential-gate';",
      ...credentialSanitizerFixture(),
      "function credentialGatedRequest(owner) {",
      "  return {",
      `    ${method}: async (...args) => {`,
      "      await assertProfileCredentialGate();",
      "      const context = owner.request;",
      "      const options = sanitizeCredentialGatedOptions(args[1]);",
      `      return context.${method}(args[0], { ...options, maxRedirects: 0 });`,
      "    },",
      "  };",
      "}",
    ].join("\n");
    assert.deepEqual(
      scanText("e2e/helpers/credential-gate.ts", source),
      [],
      method,
    );
  }
});

test("e2e governance: rejects facade sanitizers that do not prove credential removal", () => {
  const facade = (sanitizer) =>
    [
      "import { assertProfileCredentialGate } from './profile-credential-gate';",
      "const CREDENTIAL_HEADER_NAMES = new Set();",
      "const CREDENTIAL_HEADER_PATTERN = /token/;",
      "function isPlainObject(value) { return value !== null; }",
      "function sanitizeCredentialFreeHeaders(headers) { if (CREDENTIAL_HEADER_NAMES.has('authorization') || CREDENTIAL_HEADER_PATTERN.test('token')) throw new Error('credential'); return headers; }",
      sanitizer,
      "function credentialGatedRequest(owner) {",
      "  return { get: async (...args) => {",
      "    await assertProfileCredentialGate();",
      "    const context = owner.request;",
      "    const options = sanitizeCredentialGatedOptions(args[1]);",
      "    return context.get(args[0], { ...options, maxRedirects: 0 });",
      "  }};",
      "}",
    ].join("\n");
  for (const sanitizer of [
    "function sanitizeCredentialGatedOptions(options) { return options; }",
    "function sanitizeCredentialGatedOptions(options) { if (options) return options; if (!isPlainObject(options)) { throw new Error('options'); } return { ...options, headers: sanitizeCredentialFreeHeaders(options.headers) }; }",
    "function sanitizeCredentialGatedOptions(options) { if (options === undefined) return options; if (!isPlainObject(options)) { throw new Error('options'); } return options; }",
    "function sanitizeCredentialGatedOptions(options) { if (options === undefined) return options; if (!isPlainObject(options)) { throw new Error('options'); } return { headers: sanitizeCredentialFreeHeaders(options.headers), ...options }; }",
    "function sanitizeCredentialGatedOptions(options) { if (options === undefined) return options; if (isPlainObject(options)) { throw new Error('options'); } return { ...options, headers: sanitizeCredentialFreeHeaders(options.headers) }; }",
    "function sanitizeCredentialGatedOptions(options) { if (options === undefined) return options; if (!isPlainObject(options)) { throw new Error('options'); } return { ...options, headers: options.headers }; }",
  ]) {
    assert.ok(
      scanText("e2e/helpers/credential-gate.ts", facade(sanitizer)).some(
        (item) => item.rule === "credential-bearing-api-headers",
      ),
      sanitizer,
    );
  }
});

test("e2e governance: requires APIRequestContext imports to be type-only", () => {
  for (const source of [
    "import { APIRequestContext } from '@playwright/test';",
    "import { APIRequestContext, type Page } from '@playwright/test';",
    "import APIRequestContext from '@playwright/test';",
    "import * as APIRequestContext from '@playwright/test';",
    "const { APIRequestContext } = require('@playwright/test');",
    "const { APIRequestContext } = await import('@playwright/test');",
    "const APIRequestContext = require('@playwright/test');",
    "const APIRequestContext = await import('@playwright/test');",
  ]) {
    assert.ok(
      scanText("e2e/helpers/credential-gate.ts", source).some(
        (item) => item.rule === "raw-api-request-context",
      ),
      source,
    );
  }

  for (const source of [
    "import type { APIRequestContext } from '@playwright/test';",
    "import { request, type APIRequestContext } from '@playwright/test';",
  ]) {
    const findings = scanText(
      "e2e/helpers/credential-gate.ts",
      [source, "type E2EApiRequest = Pick<APIRequestContext, 'get'>;"].join(
        "\n",
      ),
    );
    assert.deepEqual(findings, [], source);
  }
  assert.deepEqual(
    scanText(
      "e2e/helpers/credential-gate.ts",
      "import { type APIRequestContext as PlaywrightContext } from '@playwright/test';",
    ),
    [],
  );
});

test("e2e governance: reports unproven credential-helper request receivers", () => {
  for (const source of [
    "async function probe() { const context = await fake(); return context.get('/private'); }",
    "async function probe() { const context = await fake(); return context['post']('/private'); }",
    [
      "import { assertProfileCredentialGate } from './profile-credential-gate';",
      "function credentialGatedRequest(owner) {",
      "  return { get: async () => {",
      "    await assertProfileCredentialGate();",
      "    const context = owner.request;",
      "    return context.get(await fake.get('/private'));",
      "  }};",
      "}",
    ].join("\n"),
  ]) {
    const findings = scanText("e2e/helpers/credential-gate.ts", source);
    assert.ok(
      findings.some(
        (item) =>
          item.rule === "raw-api-request-context" &&
          /(?:context|fake)(?:\.|\[)/.test(item.match),
      ),
      source,
    );
  }
});

test("e2e governance: requires imported gate dominance and immutable owner provenance", () => {
  const exactWrapper = (operation, prelude = []) =>
    [
      "import { assertProfileCredentialGate } from './profile-credential-gate';",
      ...credentialSanitizerFixture(),
      "function credentialGatedRequest(owner) {",
      ...prelude.map((line) => `  ${line}`),
      "  return {",
      "    get: async (...args) => {",
      ...operation.map((line) => `      ${line}`),
      "    },",
      "  };",
      "}",
    ].join("\n");

  assert.deepEqual(
    scanText(
      "e2e/helpers/credential-gate.ts",
      exactWrapper([
        "await assertProfileCredentialGate();",
        "const context = owner.request;",
        "const options = sanitizeCredentialGatedOptions(args[1]);",
        "return context.get(args[0], { ...options, maxRedirects: 0 });",
      ]),
    ),
    [],
  );

  for (const operation of [
    [
      "const context = owner.request;",
      "const options = sanitizeCredentialGatedOptions(args[1]);",
      "return context.get(args[0], { ...options, maxRedirects: 0 });",
    ],
    [
      "const context = owner.request;",
      "await assertProfileCredentialGate();",
      "const options = sanitizeCredentialGatedOptions(args[1]);",
      "return context.get(args[0], { ...options, maxRedirects: 0 });",
    ],
    [
      "if (enabled) await assertProfileCredentialGate();",
      "const context = owner.request;",
      "const options = sanitizeCredentialGatedOptions(args[1]);",
      "return context.get(args[0], { ...options, maxRedirects: 0 });",
    ],
    [
      "const assertProfileCredentialGate = async () => undefined;",
      "await assertProfileCredentialGate();",
      "const context = owner.request;",
      "const options = sanitizeCredentialGatedOptions(args[1]);",
      "return context.get(args[0], { ...options, maxRedirects: 0 });",
    ],
  ]) {
    const findings = scanText(
      "e2e/helpers/credential-gate.ts",
      exactWrapper(operation),
    );
    assert.ok(
      findings.some((item) => item.rule === "raw-api-request-context"),
      operation.join("\n"),
    );
  }

  for (const source of [
    exactWrapper(
      [
        "await assertProfileCredentialGate();",
        "const context = owner.request;",
        "const options = sanitizeCredentialGatedOptions(args[1]);",
        "return context.get(args[0], { ...options, maxRedirects: 0 });",
      ],
      ["owner = fakeOwner;"],
    ),
    [
      "import { assertProfileCredentialGate } from './profile-credential-gate';",
      "assertProfileCredentialGate = fakeGate;",
      "function credentialGatedRequest(owner) {",
      "  return { get: async (...args) => {",
      "    await assertProfileCredentialGate();",
      "    const context = owner.request;",
      "    return context.get(...args);",
      "  }};",
      "}",
    ].join("\n"),
    [
      "function credentialGatedRequest(owner, beforeRequest) {",
      "  beforeRequest = fakeGate;",
      "  return { get: async (...args) => {",
      "    await beforeRequest();",
      "    const context = owner.request;",
      "    return context.get(...args);",
      "  }};",
      "}",
    ].join("\n"),
    [
      "const assertProfileCredentialGate = async () => undefined;",
      "function credentialGatedRequest(owner) {",
      "  return { get: async (...args) => {",
      "    await assertProfileCredentialGate();",
      "    const context = owner.request;",
      "    return context.get(...args);",
      "  }};",
      "}",
    ].join("\n"),
  ]) {
    assert.ok(
      scanText("e2e/helpers/credential-gate.ts", source).some(
        (item) => item.rule === "raw-api-request-context",
      ),
      source,
    );
  }
});

test("e2e governance: rejects context aliasing, reassignment, and exposure", () => {
  const wrapper = (operation) =>
    [
      "import { assertProfileCredentialGate } from './profile-credential-gate';",
      "function credentialGatedRequest(owner) {",
      "  return { get: async (...args) => {",
      ...operation.map((line) => `    ${line}`),
      "  }};",
      "}",
    ].join("\n");

  for (const operation of [
    [
      "await assertProfileCredentialGate();",
      "const context = owner.request;",
      "const alias = context;",
      "return alias.get(...args);",
    ],
    [
      "await assertProfileCredentialGate();",
      "let context = owner.request;",
      "context = fake;",
      "return context.get(...args);",
    ],
    [
      "await assertProfileCredentialGate();",
      "const context = owner.request;",
      "return context;",
    ],
    [
      "await assertProfileCredentialGate();",
      "const context = owner.request;",
      "return { context };",
    ],
  ]) {
    assert.ok(
      scanText("e2e/helpers/credential-gate.ts", wrapper(operation)).some(
        (item) => item.rule === "raw-api-request-context",
      ),
      operation.join("\n"),
    );
  }
});

test("e2e governance: requires an immutable empty-storage isolated context", () => {
  const isolated = (operation, storageState = "{ cookies: [], origins: [] }") =>
    [
      "import { request, type APIRequestContext } from '@playwright/test';",
      "async function executeUnauthenticatedRequest(method, args) {",
      `  const context: APIRequestContext = await request.newContext({ storageState: ${storageState} });`,
      "  try {",
      ...operation.map((line) => `    ${line}`),
      "  } finally {",
      "    await context.dispose();",
      "  }",
      "}",
    ].join("\n");

  assert.deepEqual(
    scanText(
      "e2e/helpers/credential-gate.ts",
      isolated(["return context[method](...args);"]),
    ),
    [],
  );

  for (const source of [
    isolated(["const alias = context;", "return alias.get(...args);"]),
    isolated([
      "context = await request.newContext({ storageState: { cookies: [], origins: [] } });",
      "return context[method](...args);",
    ]),
    isolated(["return context;"]),
    isolated(["return { context };"]),
    isolated(["return context[method](...args);"], "{ cookies: [], origins }"),
    [
      "import { request, type APIRequestContext } from '@playwright/test';",
      "async function executeUnauthenticatedRequest(method, args) {",
      "  const context: APIRequestContext = await request.newContext({",
      "    baseURL: await fake.get('/private'),",
      "    storageState: { cookies: [], origins: [] },",
      "  });",
      "  try { return context[method](...args); } finally { await context.dispose(); }",
      "}",
    ].join("\n"),
    [
      "import { request, type APIRequestContext } from '@playwright/test';",
      "async function executeUnauthenticatedRequest(method, args) {",
      "  const context: APIRequestContext = await fake();",
      "  return context.get(...args);",
      "}",
    ].join("\n"),
  ]) {
    assert.ok(
      scanText("e2e/helpers/credential-gate.ts", source).some(
        (item) => item.rule === "raw-api-request-context",
      ),
      source,
    );
  }
});

test("e2e governance: requires direct awaited cleanup in an unconditional finally", () => {
  const isolated = (cleanup, between = []) =>
    [
      "import { request, type APIRequestContext } from '@playwright/test';",
      "async function executeUnauthenticatedRequest(method, args) {",
      "  const context: APIRequestContext = await request.newContext({ storageState: { cookies: [], origins: [] } });",
      ...between.map((line) => `  ${line}`),
      "  try {",
      "    return context[method](...args);",
      "  } finally {",
      ...cleanup.map((line) => `    ${line}`),
      "  }",
      "}",
    ].join("\n");

  for (const source of [
    isolated(["if (enabled) await context.dispose();"]),
    isolated(["context.dispose();"]),
    isolated(["void context.dispose();"]),
    isolated(["return context.dispose();"]),
    isolated(["await dispose(context);"]),
    isolated(["await context?.dispose();"]),
    isolated(["await context.dispose?.();"]),
    isolated(["await context?.dispose?.();"]),
    isolated(["await context['dispose']();"]),
    isolated(["await (context.dispose());"]),
    isolated(["await (enabled && context.dispose());"]),
    isolated(["const dispose = context.dispose;", "await dispose();"]),
    isolated([
      "const dispose = context.dispose.bind(context);",
      "await dispose();",
    ]),
    isolated(["const alias = context;", "await alias.dispose();"]),
    isolated(["const context = fakeContext;", "await context.dispose();"]),
    isolated(["audit();", "await context.dispose();"]),
    isolated(["await context.dispose();"], ["if (skip) return;"]),
    [
      "import { request, type APIRequestContext } from '@playwright/test';",
      "async function executeUnauthenticatedRequest(method, args) {",
      "  if (enabled) {",
      "    const context: APIRequestContext = await request.newContext({ storageState: { cookies: [], origins: [] } });",
      "    try { return context[method](...args); } finally { await context.dispose(); }",
      "  }",
      "}",
    ].join("\n"),
    [
      "import { request, type APIRequestContext } from '@playwright/test';",
      "async function executeUnauthenticatedRequest(method, args) {",
      "  const context: APIRequestContext = await request.newContext({ storageState: { cookies: [], origins: [] } });",
      "  try { return local(); } finally { await context.dispose(); }",
      "  return context[method](...args);",
      "}",
    ].join("\n"),
    [
      "import { request, type APIRequestContext } from '@playwright/test';",
      "async function executeUnauthenticatedRequest(method, args) {",
      "  const context: APIRequestContext = await request.newContext({ storageState: { cookies: [], origins: [] } });",
      "  try { context.get('/other'); return context[method](...args); } finally { await context.dispose(); }",
      "}",
    ].join("\n"),
    [
      "import { request, type APIRequestContext } from '@playwright/test';",
      "async function executeUnauthenticatedRequest(method, args) {",
      "  const context: APIRequestContext = await request.newContext({ storageState: { cookies: [], origins: [] } });",
      "  await context.dispose();",
      "  try { return context[method](...args); } catch (error) { await context.dispose(); throw error; }",
      "}",
    ].join("\n"),
  ]) {
    assert.ok(
      scanText("e2e/helpers/credential-gate.ts", source).some(
        (item) => item.rule === "raw-api-request-context",
      ),
      source,
    );
  }

  const valid = [
    "import { request, type APIRequestContext } from '@playwright/test';",
    "async function executeUnauthenticatedRequest(method, args) {",
    "  const context: APIRequestContext = await request.newContext({ storageState: { cookies: [], origins: [] } });",
    "  try {",
    "    return await context[method](...args);",
    "  } catch (error) {",
    "    throw error;",
    "  } finally {",
    "    await context.dispose();",
    "  }",
    "}",
  ].join("\n");
  assert.deepEqual(scanText("e2e/helpers/credential-gate.ts", valid), []);
});

test("e2e governance: follows context factories without trusting newContext shadows", () => {
  const unsafe = [
    "const create=browser.newContext; await create({extraHTTPHeaders:{Cookie:secret}})",
    "const create=browser['newContext']; await create?.({extraHTTPHeaders:{Authorization:secret}})",
    "const key='newContext'; const create=browser[key]; await create({storageState:'auth.json'})",
    "const first=browser.newContext; const second=first; const create=second; await create({extraHTTPHeaders:{'X-Auth-Token':secret}})",
    "let create; create=browser.newContext; await create({extraHTTPHeaders:{Cookie:secret}})",
    "let create=local; create=browser.newContext; await create({storageState:{cookies:[saved],origins:[]}})",
    "const {newContext:create}=browser; await create({extraHTTPHeaders:{Cookie:secret}})",
    "const {['newContext']:create}=browser; await create({storageState:state})",
    "const create=browser.newContext.bind(browser); await create({extraHTTPHeaders:{Cookie:secret}})",
    "const create=browser.newContext.bind(browser,{storageState:'auth.json'}); await create()",
    "const create=request.newContext; await create({storageState:'auth.json'})",
    "const state={cookies:[saved],origins:[]}; const options={storageState:state}; const create=browser.newContext; await create(options)",
  ];
  for (const source of unsafe) {
    assert.ok(
      scanText("e2e/context-factory-bypass.spec.ts", source).some(
        (item) => item.rule === "credential-bearing-api-headers",
      ),
      source,
    );
  }

  const requestAlias = [
    "const create=request.newContext;",
    "const context=await create({storageState:{cookies:[],origins:[]}});",
    "await context.get('/private');",
  ].join("\n");
  assert.ok(
    scanText("e2e/context-factory-bypass.spec.ts", requestAlias).some(
      (item) =>
        item.rule === "raw-api-request-context" && item.lineNumber === 3,
    ),
  );

  for (const source of [
    "const browser={newContext(){return local;}}; const create=browser.newContext; await create({extraHTTPHeaders:{Cookie:secret}})",
    "const service={newContext(){return local;}}; const {newContext:create}=service; await create({storageState:'local.json'})",
    "const empty=[]; const state={cookies:empty,origins:empty}; const create=browser.newContext; await create({storageState:state,extraHTTPHeaders:{Accept:'application/json'}})",
  ]) {
    assert.equal(
      scanText("e2e/context-factory-safe.spec.ts", source).some(
        (item) => item.rule === "credential-bearing-api-headers",
      ),
      false,
      source,
    );
  }
});

test("e2e governance: only approves direct request context creation", () => {
  const helper = (creation) =>
    [
      "import { request, type APIRequestContext } from '@playwright/test';",
      "async function executeUnauthenticatedRequest(method, args) {",
      `  const context: APIRequestContext = ${creation};`,
      "  try { return context[method](...args); } finally { await context.dispose(); }",
      "}",
    ].join("\n");
  for (const creation of [
    "await request?.newContext({ storageState: { cookies: [], origins: [] } })",
    "await request.newContext?.({ storageState: { cookies: [], origins: [] } })",
    "await request['newContext']({ storageState: { cookies: [], origins: [] } })",
    "await create({ storageState: { cookies: [], origins: [] } })",
  ]) {
    assert.ok(
      scanText("e2e/helpers/credential-gate.ts", helper(creation)).some(
        (item) => item.rule === "raw-api-request-context",
      ),
      creation,
    );
  }
  assert.deepEqual(
    scanText(
      "e2e/helpers/credential-gate.ts",
      helper(
        "await request.newContext({ storageState: { cookies: [], origins: [] } })",
      ),
    ),
    [],
  );
});

test("e2e governance: rejects credential headers and unknown option composition", () => {
  const cases = [
    "await browser.newContext({ extraHTTPHeaders: { Authorization: token } });",
    "const headers = { Cookie: cookie }; await browser.newContext({ extraHTTPHeaders: headers });",
    "const headers = { 'Proxy-Authorization': token }; const options = { extraHTTPHeaders: { ...headers } }; await browser.newContext(options);",
    "const name = 'X-Auth-Token'; const headers = { [name]: token }; await browser.newContext({ extraHTTPHeaders: headers });",
    "await browser.newContext({ extraHTTPHeaders: { aUtHoRiZaTiOn: token } });",
    "await browser.newContext({ extraHTTPHeaders: loadHeaders() });",
    "await browser.newContext(loadContextOptions());",
    "import { request } from '@playwright/test'; await request.get('/public', { headers: { cookie: secret } });",
    "import { request } from '@playwright/test'; const headers = { 'X-Private-Token': secret }; await request.post('/public', { headers: { ...headers } });",
    "import { request } from '@playwright/test'; await request.get('/public', { ...loadOptions() });",
  ];
  for (const source of cases) {
    assert.ok(
      scanText("e2e/header-bypass.spec.ts", source).some(
        (item) => item.rule === "credential-bearing-api-headers",
      ),
      source,
    );
  }
});

test("e2e governance: accepts statically credential-free header composition", () => {
  for (const source of [
    "const headers = { Accept: 'application/json' }; await browser.newContext({ extraHTTPHeaders: { ...headers } });",
    "import { request } from '@playwright/test'; const options = { headers: { 'Content-Type': 'application/json' } }; await request.post('/public', options);",
    "await browser.newContext({ storageState: { cookies: [], origins: [] } });",
  ]) {
    assert.equal(
      scanText("e2e/safe-headers.spec.ts", source).some(
        (item) => item.rule === "credential-bearing-api-headers",
      ),
      false,
      source,
    );
  }
});

test("e2e governance: approves the complete credential helper contract", () => {
  const source = readFileSync(
    join(process.cwd(), "e2e", "helpers", "credential-gate.ts"),
    "utf8",
  );
  assert.deepEqual(scanText("e2e/helpers/credential-gate.ts", source), []);
});

test("e2e governance: resolves header aliases conservatively", () => {
  const unsafe = [
    "let options = { extraHTTPHeaders: { Cookie: secret } }; await browser.newContext(options);",
    "const options = options; await browser.newContext(options);",
    "const options = { get extraHTTPHeaders() { return {}; } }; await browser.newContext(options);",
    "const key = loadKey(); await browser.newContext({ extraHTTPHeaders: { [key]: secret } });",
    "const key = key; await browser.newContext({ extraHTTPHeaders: { [key]: secret } });",
    "const options = {}; options.extraHTTPHeaders = safe; await browser.newContext(options);",
    "const options = { extraHTTPHeaders: undefined }; options = replacement; await browser.newContext(options);",
    "function sanitizeCredentialGatedOptions(value) { return value; } const safe = sanitizeCredentialGatedOptions(loadOptions()); await browser.newContext({ ...safe });",
    "const duplicate = {}; const duplicate = {}; await browser.newContext(duplicate);",
  ];
  for (const source of unsafe) {
    assert.ok(
      scanText("e2e/header-alias.spec.ts", source).some(
        (item) => item.rule === "credential-bearing-api-headers",
      ),
      source,
    );
  }

  for (const source of [
    "await browser.newContext({ extraHTTPHeaders: undefined });",
    "await browser.newContext({ extraHTTPHeaders: { ['Accept']: 'text/plain', [`Range`]: 'bytes=0-1', [7]: 'safe' } });",
    "const key = 'Accept'; const alias = key; await browser.newContext({ extraHTTPHeaders: { [alias]: 'text/plain' } });",
    "const headers = { Accept: 'text/plain' }; await browser.newContext({ extraHTTPHeaders: headers });",
  ]) {
    assert.equal(
      scanText("e2e/header-alias-safe.spec.ts", source).some(
        (item) => item.rule === "credential-bearing-api-headers",
      ),
      false,
      source,
    );
  }
});

test("e2e governance: rejects malformed credential facade placements", () => {
  const wrapper = (operation, property = "get: async (...args)") =>
    [
      "import { assertProfileCredentialGate } from './profile-credential-gate';",
      "function sanitizeCredentialGatedOptions(options) { return options; }",
      "function credentialGatedRequest(owner) {",
      `  return { ${property} => {`,
      ...operation.map((line) => `    ${line}`),
      "  }};",
      "}",
    ].join("\n");
  const validOperation = [
    "await assertProfileCredentialGate();",
    "const context = owner.request;",
    "const options = sanitizeCredentialGatedOptions(args[1]);",
    "return context.get(args[0], { ...options, maxRedirects: 0 });",
  ];
  const cases = [
    wrapper(validOperation, "get: (...args)"),
    wrapper(validOperation, "unknown: async (...args)"),
    wrapper(validOperation, "get: async (args)"),
    wrapper([
      "await assertProfileCredentialGate(extra);",
      ...validOperation.slice(1),
    ]),
    wrapper([
      "const gate = assertProfileCredentialGate;",
      "await gate();",
      ...validOperation.slice(1),
    ]),
    wrapper([
      validOperation[0],
      "let context = owner.request;",
      ...validOperation.slice(2),
    ]),
    wrapper([
      validOperation[0],
      "const context = owner['other'];",
      ...validOperation.slice(2),
    ]),
    wrapper([
      ...validOperation.slice(0, 2),
      "let options = sanitizeCredentialGatedOptions(args[1]);",
      validOperation[3],
    ]),
    wrapper([
      ...validOperation.slice(0, 2),
      "const options = fake(args[1]);",
      validOperation[3],
    ]),
    wrapper([
      ...validOperation.slice(0, 2),
      "const options = sanitizeCredentialGatedOptions(args[0]);",
      validOperation[3],
    ]),
    wrapper(["args = [];", ...validOperation]),
    wrapper([
      ...validOperation.slice(0, 3),
      "context.get(args[0], { ...options, maxRedirects: 0 });",
    ]),
    wrapper([
      ...validOperation.slice(0, 3),
      "return context.get(args[1], { ...options, maxRedirects: 0 });",
    ]),
    wrapper([
      ...validOperation.slice(0, 3),
      "return context.get(args[0], options);",
    ]),
    wrapper([
      ...validOperation.slice(0, 3),
      "return context.get(args[0], { ...options, maxRedirects: 1 });",
    ]),
  ];
  for (const source of cases) {
    assert.ok(
      scanText("e2e/helpers/credential-gate.ts", source).some(
        (item) => item.rule === "raw-api-request-context",
      ),
      source,
    );
  }
});

test("e2e governance: follows compound capability and assignment syntax", () => {
  const cases = [
    "const fn = enabled ? fetch : local; fn('/private');",
    "const fn = (local, fetch); fn('/private');",
    "const name = 'fe' + 'tch'; globalThis[name]('/private');",
    "const values = [local, fetch]; const [first, ...rest] = values; rest[0]('/private');",
    "const values = [local, ...loadValues()]; const [first, ...rest] = values; rest[0]('/private');",
    "let target; ({ value: target } = { value: fetch }); target('/private');",
    "let target; ({ target } = { target: fetch }); target('/private');",
    "let target; ({ ...target } = { fetch }); target.fetch('/private');",
    "let target; [target] = [fetch]; target('/private');",
    "let target; [...target] = [local, fetch]; target[1]('/private');",
    "const { request = fallback } = page; request.get('/private');",
    "import process from 'node:process'; process.getBuiltinModule('http').get('/private');",
    "import { spawn } from 'node:child_process'; const tool = 'curl'; spawn(`${tool} https://example.test`);",
    "const APIRequestContext = loadSomethingElse();",
  ];
  let detected = 0;
  for (const source of cases) {
    const findings = scanText(
      "e2e/compound-capability.spec.ts",
      [
        "const local = () => undefined;",
        "const fallback = local;",
        "function loadValues() { return [fetch]; }",
        source,
      ].join("\n"),
    );
    if (findings.length > 0) detected += 1;
  }
  assert.ok(detected >= 8);
});

test("e2e governance: validates computed isolated-context syntax", () => {
  const source = [
    "import { request, type APIRequestContext } from '@playwright/test';",
    "async function executeUnauthenticatedRequest(method, args) {",
    "  const context: APIRequestContext = await request.newContext({ ['storageState']: { [`cookies`]: [], ['origins']: [] } });",
    "  try { return context[method](...args); } finally { await context.dispose(); }",
    "}",
  ].join("\n");
  assert.deepEqual(scanText("e2e/helpers/credential-gate.ts", source), []);

  for (const invalid of [
    "{ cookies: [saved], origins: [] }",
    "{ cookies: [], origins: [], extra: [] }",
  ]) {
    const malformed = source.replace(
      "{ [`cookies`]: [], ['origins']: [] }",
      invalid,
    );
    assert.ok(
      scanText("e2e/helpers/credential-gate.ts", malformed).some(
        (item) => item.rule === "raw-api-request-context",
      ),
      invalid,
    );
  }

  const incremented = source.replace("try {", "context++; try {");
  assert.ok(
    scanText("e2e/helpers/credential-gate.ts", incremented).some(
      (item) => item.rule === "raw-api-request-context",
    ),
  );
});

test("e2e governance: rejects extra APIRequestContext bindings in the credential helper", () => {
  const cases = [
    [
      "let bypass: APIRequestContext; bypass.get('/private');",
      "bypass.get('/private')",
    ],
    [
      "let bypass: APIRequestContext; const alias = bypass; alias.get('/private');",
      "alias.get('/private')",
    ],
    [
      "let bypass: APIRequestContext; const { get } = bypass; get('/private');",
      "get('/private')",
    ],
    [
      "let bypass: APIRequestContext; bypass['get']('/private');",
      "bypass['get']('/private')",
    ],
  ];

  for (const [body, runtimeMatch] of cases) {
    const source = [
      "import { request, type APIRequestContext } from '@playwright/test';",
      body,
    ].join("\n");
    const findings = scanText("e2e/helpers/credential-gate.ts", source).filter(
      (item) => item.rule === "raw-api-request-context",
    );
    assert.ok(
      findings.some((item) => item.match === runtimeMatch),
      body,
    );
  }

  for (const body of [
    "type Bypass = APIRequestContext;",
    "type E2EApiRequest = APIRequestContext;",
    "type UnauthenticatedE2EApiRequest = APIRequestContext;",
  ]) {
    assert.ok(
      scanText(
        "e2e/helpers/credential-gate.ts",
        [
          "import { request, type APIRequestContext } from '@playwright/test';",
          body,
        ].join("\n"),
      ).some((item) => item.rule === "raw-api-request-context"),
      body,
    );
  }
});

test("e2e governance: rejects aliases of approved credential helper bindings", () => {
  const source = [
    "import { request, type APIRequestContext } from '@playwright/test';",
    "async function executeUnauthenticatedRequest(method) {",
    "  const context: APIRequestContext = await request.newContext();",
    "  const bypass = context;",
    "  bypass['get']('/private');",
    "  context.get('/private');",
    "  return context[method]('/public');",
    "}",
  ].join("\n");

  const findings = scanText("e2e/helpers/credential-gate.ts", source).filter(
    (item) => item.rule === "raw-api-request-context",
  );
  assert.ok(findings.some((item) => item.lineNumber === 4));
  assert.ok(findings.some((item) => item.lineNumber === 5));
  assert.ok(findings.some((item) => item.lineNumber === 6));
});

test("e2e governance: rejects extra request contexts in the approved helper function", () => {
  const source = [
    "import { request, type APIRequestContext } from '@playwright/test';",
    "async function executeUnauthenticatedRequest(method) {",
    "  const context: APIRequestContext = await request.newContext();",
    "  await request.newContext();",
    "  return context[method]('/public');",
    "}",
  ].join("\n");

  assert.ok(
    scanText("e2e/helpers/credential-gate.ts", source).some(
      (item) =>
        item.rule === "raw-api-request-context" && item.lineNumber === 4,
    ),
  );
});

test("e2e governance: scans roots while skipping dependency directories", (t) => {
  const repoRoot = createTestFixtureRoot("e2e-governance-scan-test", t);
  mkdirSync(join(repoRoot, "e2e", "nested"), { recursive: true });
  mkdirSync(join(repoRoot, "e2e", "node_modules"), { recursive: true });
  mkdirSync(join(repoRoot, "src", "lib"), { recursive: true });
  writeFileSync(
    join(repoRoot, "e2e", "nested", "bad.spec.ts"),
    "test.only('focused', async () => {});\n",
  );
  writeFileSync(
    join(repoRoot, "e2e", "node_modules", "ignored.spec.ts"),
    "test.only('ignored', async () => {});\n",
  );
  writeFileSync(
    join(repoRoot, "src", "lib", "ok.test.ts"),
    "test('ok', () => {});\n",
  );

  const findings = scanGovernance(repoRoot);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "test-only");
});

test("e2e governance CLI reports pass and failure results", (t) => {
  const scriptPath = join(process.cwd(), "scripts", "check-e2e-governance.mjs");
  const passRoot = createTestFixtureRoot("e2e-governance-cli-pass", t);
  const failRoot = createTestFixtureRoot("e2e-governance-cli-fail", t);
  mkdirSync(join(passRoot, "e2e"), { recursive: true });
  mkdirSync(join(failRoot, "e2e"), { recursive: true });
  writeFileSync(
    join(passRoot, "e2e", "ok.spec.ts"),
    "test('ok', async () => {});\n",
  );
  writeFileSync(
    join(failRoot, "e2e", "bad.spec.ts"),
    "test.only('bad', async () => {});\n",
  );

  const passed = spawnSync(process.execPath, [scriptPath], {
    cwd: passRoot,
    encoding: "utf8",
  });
  assert.equal(passed.status, 0);
  assert.match(passed.stdout, /passed/);

  const failed = spawnSync(process.execPath, [scriptPath], {
    cwd: failRoot,
    encoding: "utf8",
  });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /test-only/);
});
