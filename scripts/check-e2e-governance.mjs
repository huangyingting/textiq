#!/usr/bin/env node

import process from "node:process";
import ts from "typescript";
import {
  lineAndColumn,
  scanRepositoryRoots,
  toPosix,
} from "./source-scan-utils.mjs";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const TEST_SIZE_LIMIT = 1_500;
const OVERSIZED_TEST_ALLOWLIST = new Set([
  // deck-schema.test.ts was split into focused per-concern files (#1147)
]);
const FIXTURE_FACTORY_FILES = new Set([
  "e2e/presentation/slides-layout-screenshots.spec.ts",
]);
const RULES = [
  { rule: "test-only", pattern: /\btest\.only\s*\(/g },
  { rule: "test-skip", pattern: /\btest\.skip\s*\(/g },
  { rule: "wait-for-timeout", pattern: /\bwaitForTimeout\s*\(/g },
  {
    rule: "forced-click",
    pattern:
      /\.click\s*\(\s*\{[\s\S]{0,300}?\bforce\s*:\s*true\b[\s\S]{0,300}?\}\s*\)/g,
  },
  {
    rule: "nondeterministic-id",
    pattern:
      /\b(?:Date\.now|Math\.random|randomUUID|crypto\.randomUUID|nanoid)\s*\(/g,
  },
  {
    rule: "broad-catch",
    pattern:
      /\.catch\s*\(\s*(?:\(\s*\)|[a-zA-Z_$][\w$]*)\s*=>\s*(?:\{\s*\}|null|false)\s*\)/g,
  },
  { rule: "broad-catch", pattern: /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g },
];
const FACTORY_PATTERN =
  /\b(?:function|const)\s+(makeDeck|makeSlide|textEl|shapeEl)\b/g;
const FIXED_SLEEP_TEST_FILES = new Set([
  "src/app/app/documents/[id]/slides/slide-editor-route-client.test.tsx",
]);
const FIXED_SLEEP_PATTERN =
  /\b(?:globalThis\.)?setTimeout\s*\(\s*[^,\n]+,\s*\d[\d_]*\s*\)/g;
const ALLOW_MARKER = "e2e-governance-allow";
const CREDENTIAL_REQUEST_WRAPPER = "e2e/helpers/credential-gate.ts";
const HOSTILE_HTTP_LISTENER_SPEC =
  "e2e/auth/authenticated-nested-routes.spec.ts";
const API_REQUEST_METHODS = new Set([
  "delete",
  "fetch",
  "get",
  "head",
  "newContext",
  "patch",
  "post",
  "put",
]);
const API_OPERATION_METHODS = new Set(
  [...API_REQUEST_METHODS].filter((method) => method !== "newContext"),
);
const NETWORK_MODULES = new Set([
  "http",
  "https",
  "http2",
  "net",
  "tls",
  "node:http",
  "node:https",
  "node:http2",
  "node:net",
  "node:tls",
  "node:undici",
  "undici",
]);
const CHILD_PROCESS_MODULES = new Set(["child_process", "node:child_process"]);
const MODULE_MODULES = new Set(["module", "node:module"]);
const SHELL_METHODS = new Set([
  "exec",
  "execFile",
  "execFileSync",
  "execSync",
  "fork",
  "spawn",
  "spawnSync",
]);
const GLOBAL_FETCH_OWNERS = new Set(["global", "globalThis", "self", "window"]);
const CALLABLE_CAPABILITIES = new Set([
  "fetch",
  "reflect-apply",
  "reflect-get",
  "require",
  "create-require",
  "get-builtin-module",
]);
const CREDENTIAL_HEADER_NAMES = new Set([
  "api-key",
  "authorization",
  "cookie",
  "cookie2",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-authorization",
  "x-forwarded-authorization",
  "x-http-authorization",
  "x-original-authorization",
]);
const CREDENTIAL_HEADER_PATTERN =
  /(?:^|[-_])(?:api[-_]?key|auth(?:orization)?|cookie|credential|password|secret|session|token)(?:$|[-_])/i;

function hasAllowComment(lines, lineNumber, rule) {
  const window = lines.slice(Math.max(0, lineNumber - 3), lineNumber);
  return window.some(
    (line) => line.includes(ALLOW_MARKER) && line.includes(rule),
  );
}

function hasFileAllowComment(lines, rule) {
  return lines.some(
    (line) => line.includes(ALLOW_MARKER) && line.includes(rule),
  );
}

function isApprovedFinding(filePath, lines, item) {
  if (hasAllowComment(lines, item.lineNumber, item.rule)) {
    return true;
  }
  if (item.rule === "test-skip") {
    const callWindow = lines
      .slice(item.lineNumber - 1, Math.min(lines.length, item.lineNumber + 4))
      .join("\n");
    if (/Set E2E_|E2E_PROFILE/.test(callWindow)) {
      return true;
    }
  }
  return false;
}

function finding(filePath, text, index, rule, match) {
  const { lineNumber, columnNumber } = lineAndColumn(text, index);
  return { filePath, lineNumber, columnNumber, rule, match };
}

export function scanText(filePath, text) {
  const findings = [];
  const normalized = toPosix(filePath);
  const lines = text.split(/\r?\n/);

  if (normalized.startsWith("e2e/")) {
    for (const { rule, pattern } of RULES) {
      for (const match of text.matchAll(pattern)) {
        const item = finding(
          normalized,
          text,
          match.index ?? 0,
          rule,
          match[0],
        );
        if (!isApprovedFinding(normalized, lines, item)) {
          findings.push(item);
        }
      }
    }
    findings.push(...scanRawApiRequests(normalized, text));
    findings.push(...scanUnsafeBrowserActivations(normalized, text));
  }

  if (FIXTURE_FACTORY_FILES.has(normalized)) {
    for (const match of text.matchAll(FACTORY_PATTERN)) {
      const item = finding(
        normalized,
        text,
        match.index ?? 0,
        "local-fixture-factory",
        match[0],
      );
      if (!isApprovedFinding(normalized, lines, item)) {
        findings.push(item);
      }
    }
  }

  if (FIXED_SLEEP_TEST_FILES.has(normalized)) {
    for (const match of text.matchAll(FIXED_SLEEP_PATTERN)) {
      findings.push(
        finding(
          normalized,
          text,
          match.index ?? 0,
          "fixed-test-sleep",
          match[0],
        ),
      );
    }
  }

  if (
    (normalized.endsWith(".test.ts") || normalized.endsWith(".spec.ts")) &&
    !OVERSIZED_TEST_ALLOWLIST.has(normalized)
  ) {
    const lineCount = lines.length;
    if (
      lineCount > TEST_SIZE_LIMIT &&
      !hasFileAllowComment(lines, "oversized-test")
    ) {
      findings.push({
        filePath: normalized,
        lineNumber: TEST_SIZE_LIMIT + 1,
        columnNumber: 1,
        rule: "oversized-test",
        match: `${lineCount} lines`,
      });
    }
  }

  return findings;
}

function scanUnsafeBrowserActivations(filePath, text) {
  const findings = [];
  const findingKeys = new Set();
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const addFinding = (node, rule) => {
    const index = node.getStart(sourceFile);
    const key = `${index}:${rule}`;
    if (findingKeys.has(key)) return;
    findingKeys.add(key);
    findings.push(
      finding(filePath, text, index, rule, node.getText(sourceFile)),
    );
  };
  const unwrap = (node) => {
    let current = node;
    while (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isNonNullExpression(current)
    ) {
      current = current.expression;
    }
    return current;
  };
  const methodName = (expression) => {
    const target = unwrap(expression);
    if (ts.isPropertyAccessExpression(target)) return target.name.text;
    if (
      ts.isElementAccessExpression(target) &&
      target.argumentExpression &&
      ts.isStringLiteralLike(target.argumentExpression)
    ) {
      return target.argumentExpression.text;
    }
    return undefined;
  };
  const containsMethodCall = (node, expectedMethod) => {
    let found = false;
    const visit = (child) => {
      if (found) return;
      if (
        ts.isCallExpression(child) &&
        methodName(child.expression) === expectedMethod
      ) {
        found = true;
        return;
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
    return found;
  };
  const isDocumentQuery = (node) => {
    const target = unwrap(node);
    if (!ts.isCallExpression(target)) return false;
    const callee = unwrap(target.expression);
    return (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === "document" &&
      (callee.name.text === "querySelector" ||
        callee.name.text === "getElementById")
    );
  };

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = methodName(node.expression);
      if (
        name === "evaluate" &&
        node.arguments[0] &&
        containsMethodCall(node.arguments[0], "click")
      ) {
        addFinding(node, "dom-click-evaluate");
      }
      if (name === "dispatchEvent") {
        addFinding(node, "dispatch-event");
      }
      const callee = unwrap(node.expression);
      if (
        name === "click" &&
        ts.isPropertyAccessExpression(callee) &&
        isDocumentQuery(callee.expression)
      ) {
        addFinding(node, "direct-dom-click");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

function scanRawApiRequests(filePath, text) {
  const findings = [];
  const findingKeys = new Set();
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const analysis = analyzeCapabilities(sourceFile);
  const isApprovedCredentialHelperNode = createCredentialHelperApproval(
    filePath,
    sourceFile,
    analysis,
  );
  const isApprovedHostileHttpListenerNode = createHostileHttpListenerApproval(
    filePath,
    sourceFile,
  );
  const addFinding = (node, rule, match = node.getText(sourceFile)) => {
    if (
      isApprovedCredentialHelperNode(node, rule) ||
      isApprovedHostileHttpListenerNode(node, rule)
    ) {
      return;
    }
    const index = node.getStart(sourceFile);
    const key = `${index}:${rule}`;
    if (findingKeys.has(key)) return;
    findingKeys.add(key);
    findings.push(finding(filePath, text, index, rule, match));
  };
  const reportCapabilities = (node, capabilities) => {
    if (hasCapability(capabilities, "fetch")) {
      addFinding(node, "raw-e2e-fetch");
    }
    if (
      hasCapability(capabilities, "api-request") ||
      hasCapabilityPrefix(capabilities, "api-method:")
    ) {
      addFinding(node, "raw-api-request-context");
    }
    if (
      hasCapabilityPrefix(capabilities, "network-module:") ||
      hasCapability(capabilities, "network-client")
    ) {
      addFinding(node, "raw-e2e-network-client");
    }
    if (hasCapabilityPrefix(capabilities, "child-method:")) {
      addFinding(node, "raw-e2e-shell-network");
    }
  };

  for (const { node, binding } of analysis.bindingReports) {
    reportCapabilities(node, binding.capabilities);
  }

  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const moduleName = node.moduleSpecifier.text;
      if (NETWORK_MODULES.has(moduleName)) {
        addFinding(node.moduleSpecifier, "raw-e2e-network-client", moduleName);
      }
      if (moduleName === "@playwright/test") {
        const importClause = node.importClause;
        if (
          importClause?.name?.text === "APIRequestContext" &&
          !importClause.isTypeOnly
        ) {
          addFinding(importClause.name, "raw-api-request-context");
        }
        if (
          importClause?.namedBindings &&
          ts.isNamespaceImport(importClause.namedBindings) &&
          importClause.namedBindings.name.text === "APIRequestContext" &&
          !importClause.isTypeOnly
        ) {
          addFinding(
            importClause.namedBindings.name,
            "raw-api-request-context",
          );
        }
        for (const specifier of node.importClause?.namedBindings?.elements ??
          []) {
          const imported = specifier.propertyName?.text ?? specifier.name.text;
          if (imported === "request" || imported === "APIRequestContext") {
            addFinding(specifier, "raw-api-request-context");
          }
        }
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "APIRequestContext" &&
      isPlaywrightModuleLoad(node.initializer)
    ) {
      addFinding(node.name, "raw-api-request-context");
    }
    if (
      ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      node.typeName.text === "APIRequestContext"
    ) {
      addFinding(node.typeName, "raw-api-request-context");
    }
    if (ts.isBindingElement(node)) {
      const property = analysis.propertyName(node);
      if (property === "request") {
        addFinding(node, "raw-api-request-context");
      }
    }
    if (isAccessExpression(node)) {
      reportCapabilities(node, analysis.evaluate(node));
    }
    if (ts.isCallExpression(node)) {
      const access = directAccessExpression(node);
      const invoked = analysis.invokedCapabilities(node);
      const credentialHeaderNode = findCredentialHeaderBypass({
        analysis,
        call: node,
        filePath,
        invoked,
        sourceFile,
      });
      if (credentialHeaderNode) {
        addFinding(credentialHeaderNode, "credential-bearing-api-headers");
      }
      if (
        filePath === CREDENTIAL_REQUEST_WRAPPER &&
        access &&
        API_OPERATION_METHODS.has(
          directPropertyName(access) ?? analysis.propertyName(access),
        )
      ) {
        addFinding(node, "raw-api-request-context");
      }
      if (hasCapabilityPrefix(invoked, "child-method:")) {
        const command = analysis.shellCommand(node.arguments);
        addFinding(
          node,
          "raw-e2e-shell-network",
          command
            ? `${command} via ${node.expression.getText(sourceFile)}`
            : undefined,
        );
      }
      reportCapabilities(node, invoked);
      const results = analysis.evaluate(node);
      if (hasCapabilityPrefix(results, "child-method:")) {
        const command = analysis.shellCommand(node.arguments);
        addFinding(
          node,
          "raw-e2e-shell-network",
          command
            ? `${command} via ${node.expression.getText(sourceFile)}`
            : undefined,
        );
      }
      reportCapabilities(node, results);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

function createHostileHttpListenerApproval(filePath, sourceFile) {
  if (filePath !== HOSTILE_HTTP_LISTENER_SPEC) {
    return () => false;
  }

  let serverImport;
  let serverImportSpecifier;
  let listenerFunction;
  const createServerCalls = [];
  const invalidReferences = [];

  const containsNode = (ancestor, node) =>
    ancestor.pos <= node.pos && node.end <= ancestor.end;
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === "node:http"
    ) {
      const specifier = node.importClause?.namedBindings?.elements?.find(
        (candidate) =>
          (candidate.propertyName?.text ?? candidate.name.text) ===
            "createServer" && candidate.name.text === "createServer",
      );
      if (specifier) {
        serverImport = node;
        serverImportSpecifier = specifier;
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === "listenHostile") {
      listenerFunction = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (!serverImport || !serverImportSpecifier || !listenerFunction) {
    return () => false;
  }

  const validateReference = (node) => {
    if (
      ts.isIdentifier(node) &&
      node.text === "createServer" &&
      !containsNode(serverImport, node)
    ) {
      if (
        containsNode(listenerFunction, node) &&
        ts.isCallExpression(node.parent) &&
        node.parent.expression === node
      ) {
        createServerCalls.push(node.parent);
      } else {
        invalidReferences.push(node);
      }
    }
    ts.forEachChild(node, validateReference);
  };
  validateReference(sourceFile);

  if (invalidReferences.length > 0 || createServerCalls.length !== 1) {
    return () => false;
  }
  const [approvedCall] = createServerCalls;

  return (node, rule) =>
    rule === "raw-e2e-network-client" &&
    (node === serverImport.moduleSpecifier ||
      containsNode(serverImportSpecifier, node) ||
      containsNode(approvedCall, node));
}

function isPlaywrightModuleLoad(input) {
  if (!input) return false;
  let expression = unwrapExpression(input);
  if (ts.isAwaitExpression(expression)) {
    expression = unwrapExpression(expression.expression);
  }
  if (
    !ts.isCallExpression(expression) ||
    expression.arguments.length !== 1 ||
    !ts.isStringLiteral(expression.arguments[0]) ||
    expression.arguments[0].text !== "@playwright/test"
  ) {
    return false;
  }
  return (
    expression.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(expression.expression) &&
      expression.expression.text === "require")
  );
}

function isAccessExpression(node) {
  return (
    ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
  );
}

function isDirectZeroArgumentCall(node) {
  return (
    ts.isCallExpression(node.parent) &&
    node.parent.expression === node &&
    node.parent.arguments.length === 0
  );
}

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function findCredentialHeaderBypass({
  analysis,
  call,
  filePath,
  invoked,
  sourceFile,
}) {
  const access = directAccessExpression(call);
  const method = access
    ? (directPropertyName(access) ?? analysis.propertyName(access))
    : undefined;
  const boundFactory =
    access && method === "bind"
      ? analysis.evaluate(access.expression)
      : new Set();
  const isFactoryBind =
    hasCapability(boundFactory, "browser-context-factory") ||
    hasCapability(boundFactory, "api-method:newContext");
  const isContextCreation =
    isFactoryBind ||
    hasCapability(invoked, "browser-context-factory") ||
    hasCapability(invoked, "api-method:newContext");
  const isApiOperation =
    API_OPERATION_METHODS.has(method) &&
    (filePath === CREDENTIAL_REQUEST_WRAPPER ||
      hasCapabilityPrefix(invoked, "api-method:") ||
      hasCapability(invoked, "api-request"));
  if (!isContextCreation && !isApiOperation) return undefined;

  const options = call.arguments[isFactoryBind ? 1 : isContextCreation ? 0 : 1];
  if (!options) return undefined;
  const unsafeHeader = findUnsafeHeaderOption({
    analysis,
    expression: options,
    filePath,
    optionName: isContextCreation ? "extraHTTPHeaders" : "headers",
    sourceFile,
  });
  if (unsafeHeader || !isContextCreation) return unsafeHeader;
  return findUnsafeStorageStateOption({
    analysis,
    expression: options,
    sourceFile,
  });
}

function findUnsafeHeaderOption({
  analysis,
  expression,
  filePath,
  optionName,
  sourceFile,
}) {
  const options = resolveStaticObject(expression, {
    analysis,
    sourceFile,
    trustedSpread: (node) =>
      filePath === CREDENTIAL_REQUEST_WRAPPER &&
      (isTrustedSanitizerResult(
        node,
        "sanitizeCredentialGatedOptions",
        analysis,
        sourceFile,
      ) ||
        isTrustedSanitizerResult(
          node,
          "sanitizePublicRequestOptions",
          analysis,
          sourceFile,
        )),
  });
  if (options.unknown) return options.unknown;

  for (const property of options.properties) {
    if (property.name !== optionName) continue;
    if (
      filePath === CREDENTIAL_REQUEST_WRAPPER &&
      isTrustedCredentialHelperHeaderValue(
        property.value,
        optionName,
        analysis,
        sourceFile,
      )
    ) {
      continue;
    }
    const headers = resolveStaticObject(property.value, {
      analysis,
      sourceFile,
    });
    if (headers.unknown) return headers.unknown;
    for (const header of headers.properties) {
      const normalized = header.name.toLowerCase();
      if (
        CREDENTIAL_HEADER_NAMES.has(normalized) ||
        CREDENTIAL_HEADER_PATTERN.test(normalized)
      ) {
        return header.nameNode;
      }
    }
  }
  return undefined;
}

function findUnsafeStorageStateOption({ analysis, expression, sourceFile }) {
  const options = resolveStaticObject(expression, { analysis, sourceFile });
  if (options.unknown) return options.unknown;
  for (const property of options.properties) {
    if (property.name !== "storageState") continue;
    if (
      !isStaticallyUndefined(property.value, analysis) &&
      !isStaticallyEmptyStorageState(property.value, analysis, sourceFile)
    ) {
      return property.nameNode;
    }
  }
  return undefined;
}

function isStaticallyUndefined(node, analysis) {
  const expression = unwrapExpression(node);
  return (
    ts.isIdentifier(expression) &&
    expression.text === "undefined" &&
    !analysis.bindingForIdentifier(expression)
  );
}

function isStaticallyEmptyStorageState(
  input,
  analysis,
  sourceFile,
  seen = new Set(),
) {
  const expression = unwrapExpression(input);
  if (ts.isIdentifier(expression)) {
    const initializer = immutableBindingInitializer(
      expression,
      analysis,
      sourceFile,
    );
    if (!initializer || seen.has(initializer)) return false;
    const nextSeen = new Set(seen);
    nextSeen.add(initializer);
    return isStaticallyEmptyStorageState(
      initializer,
      analysis,
      sourceFile,
      nextSeen,
    );
  }
  const storageState = resolveStaticObject(expression, {
    analysis,
    sourceFile,
  });
  if (storageState.unknown || storageState.properties.length !== 2)
    return false;
  const emptyProperties = new Set();
  for (const property of storageState.properties) {
    if (
      (property.name !== "cookies" && property.name !== "origins") ||
      !isStaticallyEmptyArray(property.value, analysis, sourceFile, seen)
    ) {
      return false;
    }
    emptyProperties.add(property.name);
  }
  return emptyProperties.has("cookies") && emptyProperties.has("origins");
}

function isStaticallyEmptyArray(input, analysis, sourceFile, seen = new Set()) {
  const expression = unwrapExpression(input);
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.length === 0;
  }
  if (!ts.isIdentifier(expression)) return false;
  const initializer = immutableBindingInitializer(
    expression,
    analysis,
    sourceFile,
  );
  if (!initializer || seen.has(initializer)) return false;
  const nextSeen = new Set(seen);
  nextSeen.add(initializer);
  return isStaticallyEmptyArray(initializer, analysis, sourceFile, nextSeen);
}

function resolveStaticObject(
  input,
  { analysis, sourceFile, trustedSpread = () => false },
  seen = new Set(),
) {
  const expression = unwrapExpression(input);
  if (
    ts.isIdentifier(expression) &&
    expression.text === "undefined" &&
    !analysis.bindingForIdentifier(expression)
  ) {
    return { properties: [], unknown: undefined };
  }
  if (ts.isIdentifier(expression)) {
    const initializer = immutableBindingInitializer(
      expression,
      analysis,
      sourceFile,
    );
    if (!initializer || seen.has(initializer)) {
      return { properties: [], unknown: expression };
    }
    seen.add(initializer);
    return resolveStaticObject(
      initializer,
      { analysis, sourceFile, trustedSpread },
      seen,
    );
  }
  if (!ts.isObjectLiteralExpression(expression)) {
    return { properties: [], unknown: expression };
  }

  const properties = [];
  for (const property of expression.properties) {
    if (ts.isSpreadAssignment(property)) {
      if (trustedSpread(property.expression)) continue;
      const spread = resolveStaticObject(
        property.expression,
        { analysis, sourceFile, trustedSpread },
        seen,
      );
      properties.push(...spread.properties);
      if (spread.unknown) {
        return { properties, unknown: spread.unknown };
      }
      continue;
    }
    if (
      !ts.isPropertyAssignment(property) &&
      !ts.isShorthandPropertyAssignment(property)
    ) {
      return { properties, unknown: property };
    }
    const name = staticHeaderPropertyName(
      property.name,
      analysis,
      sourceFile,
      seen,
    );
    if (name === undefined) {
      return { properties, unknown: property.name };
    }
    properties.push({
      name,
      nameNode: property.name,
      value: ts.isPropertyAssignment(property)
        ? property.initializer
        : property.name,
    });
  }
  return { properties, unknown: undefined };
}

function staticHeaderPropertyName(node, analysis, sourceFile, seen) {
  if (
    ts.isIdentifier(node) ||
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node)
  ) {
    return node.text;
  }
  if (!ts.isComputedPropertyName(node)) return undefined;
  return staticComputedPropertyValue(
    node.expression,
    analysis,
    sourceFile,
    seen,
  );
}

function staticComputedPropertyValue(input, analysis, sourceFile, seen) {
  const expression = unwrapExpression(input);
  if (
    ts.isStringLiteral(expression) ||
    ts.isNumericLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return expression.text;
  }
  if (ts.isIdentifier(expression)) {
    const initializer = immutableBindingInitializer(
      expression,
      analysis,
      sourceFile,
    );
    if (!initializer || seen.has(initializer)) return undefined;
    const nextSeen = new Set(seen);
    nextSeen.add(initializer);
    return staticComputedPropertyValue(
      initializer,
      analysis,
      sourceFile,
      nextSeen,
    );
  }
  return undefined;
}

function immutableBindingInitializer(identifier, analysis, sourceFile) {
  const binding = analysis.bindingForIdentifier(identifier);
  if (!binding || binding.declarations.size !== 1) return undefined;
  const declarationIdentifier = [...binding.declarations][0];
  const declaration = findAncestor(
    declarationIdentifier,
    ts.isVariableDeclaration,
  );
  if (
    !declaration ||
    declaration.name !== declarationIdentifier ||
    !isConstVariableDeclaration(declaration) ||
    !declaration.initializer ||
    hasBindingWrite(sourceFile, declarationIdentifier, analysis)
  ) {
    return undefined;
  }
  return declaration.initializer;
}

function isTrustedCredentialHelperHeaderValue(
  expression,
  optionName,
  analysis,
  sourceFile,
) {
  if (optionName !== "extraHTTPHeaders") {
    return false;
  }
  return isApprovedHeaderSanitizerCall(
    expression,
    "sanitizePublicHeaders",
    analysis,
    sourceFile,
  );
}

function isApprovedHeaderSanitizerCall(
  expression,
  sanitizerName,
  analysis,
  sourceFile,
) {
  const call = unwrapExpression(expression);
  if (
    !ts.isCallExpression(call) ||
    call.arguments.length < 1 ||
    !ts.isIdentifier(call.expression) ||
    call.expression.text !== sanitizerName
  ) {
    return false;
  }
  const sanitizer = sourceFile.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === sanitizerName,
  );
  return Boolean(
    sanitizer?.name &&
    sameAnalysisBinding(call.expression, sanitizer.name, analysis) &&
    hasCredentialHeaderRejection(sanitizer, analysis, sourceFile),
  );
}

function isTrustedSanitizerResult(
  expression,
  sanitizerName,
  analysis,
  sourceFile,
) {
  let candidate = unwrapExpression(expression);
  if (ts.isIdentifier(candidate)) {
    const initializer = immutableBindingInitializer(
      candidate,
      analysis,
      sourceFile,
    );
    if (!initializer) return false;
    candidate = unwrapExpression(initializer);
  }
  if (
    !ts.isCallExpression(candidate) ||
    !ts.isIdentifier(candidate.expression) ||
    candidate.expression.text !== sanitizerName
  ) {
    return false;
  }
  const sanitizer = sourceFile.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === sanitizerName,
  );
  return Boolean(
    sanitizer?.name &&
    sameAnalysisBinding(candidate.expression, sanitizer.name, analysis) &&
    isApprovedOptionsSanitizer(sanitizer, sanitizerName, analysis, sourceFile),
  );
}

function isApprovedOptionsSanitizer(
  sanitizer,
  sanitizerName,
  analysis,
  sourceFile,
) {
  if (
    !sanitizer.name ||
    sanitizer.parameters.length !== 1 ||
    !ts.isIdentifier(sanitizer.parameters[0].name) ||
    !sanitizer.body ||
    sanitizer.body.statements.length !== 3 ||
    hasBindingWrite(sourceFile, sanitizer.name, analysis)
  ) {
    return false;
  }
  const options = sanitizer.parameters[0].name;
  const [undefinedGuard, plainObjectGuard, returnStatement] =
    sanitizer.body.statements;
  if (
    !isUndefinedReturnGuard(undefinedGuard, options, analysis) ||
    !isPlainObjectThrowGuard(plainObjectGuard, options, analysis) ||
    !ts.isReturnStatement(returnStatement) ||
    !returnStatement.expression
  ) {
    return false;
  }
  const result = unwrapExpression(returnStatement.expression);
  if (!ts.isObjectLiteralExpression(result) || result.properties.length !== 2) {
    return false;
  }
  const [spread, headersProperty] = result.properties;
  if (
    !ts.isSpreadAssignment(spread) ||
    !ts.isIdentifier(spread.expression) ||
    !sameAnalysisBinding(spread.expression, options, analysis) ||
    !ts.isPropertyAssignment(headersProperty) ||
    !ts.isIdentifier(headersProperty.name) ||
    headersProperty.name.text !== "headers"
  ) {
    return false;
  }
  const headerSanitizerName =
    sanitizerName === "sanitizePublicRequestOptions"
      ? "sanitizePublicHeaders"
      : "sanitizeCredentialFreeHeaders";
  const headerCall = unwrapExpression(headersProperty.initializer);
  const headerSanitizer = sourceFile.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === headerSanitizerName,
  );
  return Boolean(
    ts.isCallExpression(headerCall) &&
    headerCall.arguments.length >= 1 &&
    ts.isIdentifier(headerCall.expression) &&
    headerSanitizer?.name &&
    sameAnalysisBinding(
      headerCall.expression,
      headerSanitizer.name,
      analysis,
    ) &&
    isOptionsHeadersAccess(headerCall.arguments[0], options, analysis) &&
    hasCredentialHeaderRejection(headerSanitizer, analysis, sourceFile),
  );
}

function isUndefinedReturnGuard(statement, options, analysis) {
  if (!ts.isIfStatement(statement) || statement.elseStatement) return false;
  const condition = unwrapExpression(statement.expression);
  const thenStatement = ts.isBlock(statement.thenStatement)
    ? statement.thenStatement.statements[0]
    : statement.thenStatement;
  return Boolean(
    ts.isBinaryExpression(condition) &&
    condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    ts.isIdentifier(condition.left) &&
    sameAnalysisBinding(condition.left, options, analysis) &&
    ts.isIdentifier(condition.right) &&
    condition.right.text === "undefined" &&
    ts.isReturnStatement(thenStatement) &&
    thenStatement.expression &&
    ts.isIdentifier(thenStatement.expression) &&
    sameAnalysisBinding(thenStatement.expression, options, analysis),
  );
}

function isPlainObjectThrowGuard(statement, options, analysis) {
  if (!ts.isIfStatement(statement) || statement.elseStatement) return false;
  const condition = unwrapExpression(statement.expression);
  if (
    !ts.isPrefixUnaryExpression(condition) ||
    condition.operator !== ts.SyntaxKind.ExclamationToken
  ) {
    return false;
  }
  const call = unwrapExpression(condition.operand);
  const statements = ts.isBlock(statement.thenStatement)
    ? statement.thenStatement.statements
    : [statement.thenStatement];
  return Boolean(
    ts.isCallExpression(call) &&
    call.arguments.length === 1 &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === "isPlainObject" &&
    ts.isIdentifier(call.arguments[0]) &&
    sameAnalysisBinding(call.arguments[0], options, analysis) &&
    statements.length === 1 &&
    ts.isThrowStatement(statements[0]),
  );
}

function isOptionsHeadersAccess(node, options, analysis) {
  const expression = unwrapExpression(node);
  return (
    isAccessExpression(expression) &&
    directPropertyName(expression) === "headers" &&
    ts.isIdentifier(expression.expression) &&
    sameAnalysisBinding(expression.expression, options, analysis)
  );
}

function hasCredentialHeaderRejection(sanitizer, analysis, sourceFile) {
  if (
    !sanitizer.name ||
    hasBindingWrite(sourceFile, sanitizer.name, analysis)
  ) {
    return false;
  }
  let namesReference = false;
  let patternReference = false;
  let throwStatement = false;
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      namesReference ||= node.text === "CREDENTIAL_HEADER_NAMES";
      patternReference ||= node.text === "CREDENTIAL_HEADER_PATTERN";
    } else if (ts.isThrowStatement(node)) {
      throwStatement = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sanitizer);
  return namesReference && patternReference && throwStatement;
}

function analyzeCapabilities(sourceFile) {
  const scopeForNode = new Map();
  const assignments = [];
  const bindingReports = [];
  const returners = new Map();
  const arrayReferences = new WeakMap();
  const arrayStates = new Map();
  let nextReturnerId = 0;
  let nextArrayReferenceId = 0;

  const createScope = (parent, functionScope = false) => ({
    parent,
    functionScope,
    bindings: new Map(),
  });
  const rootScope = createScope(undefined, true);
  const declare = (scope, name, node) => {
    let binding = scope.bindings.get(name);
    if (!binding) {
      binding = { capabilities: new Set(), declarations: new Set() };
      scope.bindings.set(name, binding);
      bindingReports.push({ node, binding });
    }
    binding.declarations.add(node);
    return binding;
  };
  const declarePattern = (pattern, scope) => {
    if (ts.isIdentifier(pattern)) {
      return declare(scope, pattern.text, pattern);
    }
    if (
      ts.isObjectBindingPattern(pattern) ||
      ts.isArrayBindingPattern(pattern)
    ) {
      for (const element of pattern.elements) {
        if (ts.isBindingElement(element)) {
          declarePattern(element.name, scope);
        }
      }
    }
    return undefined;
  };
  const variableScope = (scope, declarationList) => {
    if (declarationList.flags & ts.NodeFlags.BlockScoped) return scope;
    for (let current = scope; current; current = current.parent) {
      if (current.functionScope) return current;
    }
    return scope;
  };
  const visitFunction = (node, parentScope) => {
    const functionScope = createScope(parentScope, true);
    if (ts.isFunctionExpression(node) && node.name) {
      declare(functionScope, node.name.text, node.name);
    }
    for (const parameter of node.parameters ?? []) {
      scopeForNode.set(parameter, functionScope);
      declarePattern(parameter.name, functionScope);
      ts.forEachChild(parameter, (child) => visit(child, functionScope));
    }
    if (node.body) {
      visit(node.body, functionScope);
    }
  };
  const visitClass = (node, parentScope) => {
    const classScope = createScope(parentScope);
    if (node.name) {
      declare(classScope, node.name.text, node.name);
    }
    scopeForNode.set(node, parentScope);
    ts.forEachChild(node, (child) => visit(child, classScope));
  };
  const visit = (node, scope) => {
    scopeForNode.set(node, scope);
    if (ts.isFunctionLike(node) && !ts.isSourceFile(node)) {
      if (ts.isFunctionDeclaration(node) && node.name) {
        declare(scope, node.name.text, node.name);
      }
      visitFunction(node, scope);
      return;
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      if (ts.isClassDeclaration(node) && node.name) {
        declare(scope, node.name.text, node.name);
      }
      visitClass(node, scope);
      return;
    }
    if (ts.isClassStaticBlockDeclaration(node)) {
      const staticBlockScope = createScope(scope, true);
      scopeForNode.set(node, staticBlockScope);
      visit(node.body, staticBlockScope);
      return;
    }
    if (ts.isBlock(node)) {
      const blockScope = createScope(scope);
      scopeForNode.set(node, blockScope);
      ts.forEachChild(node, (child) => visit(child, blockScope));
      return;
    }
    if (
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node)
    ) {
      const loopScope = createScope(scope);
      scopeForNode.set(node, loopScope);
      ts.forEachChild(node, (child) => visit(child, loopScope));
      return;
    }
    if (ts.isSwitchStatement(node)) {
      const switchScope = createScope(scope);
      visit(node.expression, scope);
      scopeForNode.set(node.caseBlock, switchScope);
      ts.forEachChild(node.caseBlock, (child) => visit(child, switchScope));
      return;
    }
    if (ts.isCatchClause(node)) {
      const catchScope = createScope(scope);
      scopeForNode.set(node, catchScope);
      if (node.variableDeclaration) {
        scopeForNode.set(node.variableDeclaration, catchScope);
        declarePattern(node.variableDeclaration.name, catchScope);
      }
      if (node.variableDeclaration?.initializer) {
        visit(node.variableDeclaration.initializer, catchScope);
      }
      visit(node.block, catchScope);
      return;
    }
    if (ts.isVariableDeclaration(node)) {
      const declarationList = node.parent;
      const targetScope = ts.isCatchClause(declarationList)
        ? scope
        : variableScope(scope, declarationList);
      declarePattern(node.name, targetScope);
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      declare(scope, node.name.text, node.name);
    } else if (ts.isImportClause(node) && node.name) {
      declare(scope, node.name.text, node.name);
    } else if (ts.isNamespaceImport(node)) {
      declare(scope, node.name.text, node.name);
    } else if (ts.isImportSpecifier(node)) {
      declare(scope, node.name.text, node.name);
    }
    ts.forEachChild(node, (child) => visit(child, scope));
  };
  visit(sourceFile, rootScope);

  const resolveBinding = (name, scope) => {
    for (let current = scope; current; current = current.parent) {
      const binding = current.bindings.get(name);
      if (binding) return binding;
    }
    return undefined;
  };
  const addCapabilities = (target, capabilities) => {
    let changed = false;
    for (const capability of capabilities) {
      if (!target.has(capability)) {
        target.add(capability);
        changed = true;
      }
    }
    return changed;
  };
  const stringCapability = (value) => `string:${JSON.stringify(value)}`;
  const numberCapability = (value) => `number:${JSON.stringify(value)}`;
  const staticStrings = (capabilities) =>
    [...capabilities]
      .filter((capability) => capability.startsWith("string:"))
      .map((capability) => JSON.parse(capability.slice("string:".length)));
  const staticPropertyNames = (capabilities) => [
    ...staticStrings(capabilities),
    ...[...capabilities]
      .filter((capability) => capability.startsWith("number:"))
      .map((capability) =>
        String(JSON.parse(capability.slice("number:".length))),
      ),
  ];
  const ARRAY_VALUE_CAPABILITY = "array-value";
  const ARRAY_ELEMENT_PREFIX = "array-element:";
  const ARRAY_UNKNOWN_ELEMENT_PREFIX = "array-unknown-element:";
  const ARRAY_REFERENCE_PREFIX = "array-reference:";
  const arrayElementCapability = (index, capability) =>
    `${ARRAY_ELEMENT_PREFIX}${JSON.stringify([index, capability])}`;
  const arrayUnknownElementCapability = (capability) =>
    `${ARRAY_UNKNOWN_ELEMENT_PREFIX}${JSON.stringify(capability)}`;
  const parseArrayUnknownElementCapability = (capability) => {
    if (!capability.startsWith(ARRAY_UNKNOWN_ELEMENT_PREFIX)) return undefined;
    return JSON.parse(capability.slice(ARRAY_UNKNOWN_ELEMENT_PREFIX.length));
  };
  const arrayReferenceCapability = (node) => {
    let id = arrayReferences.get(node);
    if (id === undefined) {
      id = nextArrayReferenceId;
      nextArrayReferenceId += 1;
      arrayReferences.set(node, id);
      arrayStates.set(id, new Set());
    }
    return `${ARRAY_REFERENCE_PREFIX}${id}`;
  };
  const parseArrayReferenceCapability = (capability) => {
    if (!capability.startsWith(ARRAY_REFERENCE_PREFIX)) return undefined;
    return Number(capability.slice(ARRAY_REFERENCE_PREFIX.length));
  };
  const expandedArrayCapabilities = (capabilities) => {
    const result = new Set(capabilities);
    for (const capability of capabilities) {
      const reference = parseArrayReferenceCapability(capability);
      if (reference === undefined) continue;
      addCapabilities(result, arrayStates.get(reference) ?? new Set());
    }
    return result;
  };
  const parseArrayElementCapability = (capability) => {
    if (!capability.startsWith(ARRAY_ELEMENT_PREFIX)) return undefined;
    const [index, value] = JSON.parse(
      capability.slice(ARRAY_ELEMENT_PREFIX.length),
    );
    return { index, capability: value };
  };
  const arrayElements = (capabilities) => {
    const elements = new Map();
    for (const capability of expandedArrayCapabilities(capabilities)) {
      const parsed = parseArrayElementCapability(capability);
      if (!parsed) continue;
      const element = elements.get(parsed.index) ?? new Set();
      element.add(parsed.capability);
      elements.set(parsed.index, element);
    }
    return elements;
  };
  const arrayUnknownElementCapabilities = (capabilities) => {
    const result = new Set();
    for (const capability of expandedArrayCapabilities(capabilities)) {
      const parsed = parseArrayUnknownElementCapability(capability);
      if (parsed !== undefined) result.add(parsed);
    }
    return result;
  };
  const arrayElementCapabilities = (capabilities, index) =>
    unionCapabilities([
      new Set(arrayElements(capabilities).get(index) ?? []),
      arrayUnknownElementCapabilities(capabilities),
    ]);
  const arrayAllElementCapabilities = (capabilities) =>
    unionCapabilities([
      ...arrayElements(capabilities).values(),
      arrayUnknownElementCapabilities(capabilities),
    ]);
  const arrayRestCapabilities = (capabilities, startIndex) => {
    const result = new Set([ARRAY_VALUE_CAPABILITY]);
    for (const [index, element] of arrayElements(capabilities)) {
      if (index < startIndex) continue;
      for (const capability of element) {
        result.add(arrayElementCapability(index - startIndex, capability));
      }
    }
    for (const capability of arrayUnknownElementCapabilities(capabilities)) {
      result.add(arrayUnknownElementCapability(capability));
    }
    return result;
  };
  const moduleCapabilities = (moduleName) => {
    if (NETWORK_MODULES.has(moduleName)) {
      return new Set([`network-module:${moduleName.replace(/^node:/, "")}`]);
    }
    if (CHILD_PROCESS_MODULES.has(moduleName)) {
      return new Set(["child-module"]);
    }
    if (MODULE_MODULES.has(moduleName)) {
      return new Set(["module-object"]);
    }
    if (moduleName === "process" || moduleName === "node:process") {
      return new Set(["process-object"]);
    }
    if (moduleName === "@playwright/test") {
      return new Set(["playwright-module"]);
    }
    return new Set();
  };
  const builtinCapabilities = (name, scope) => {
    if (resolveBinding(name, scope)) return new Set();
    if (GLOBAL_FETCH_OWNERS.has(name)) return new Set(["global-object"]);
    if (name === "fetch") return new Set(["fetch"]);
    if (name === "browser") return new Set(["browser-context-owner"]);
    if (name === "request") return new Set(["api-request"]);
    if (name === "Reflect") return new Set(["reflect-object"]);
    if (name === "process") return new Set(["process-object"]);
    if (name === "module") return new Set(["module-object"]);
    if (name === "require") return new Set(["require"]);
    return new Set();
  };
  const propertyName = (node) => {
    if (ts.isBindingElement(node)) {
      if (!node.propertyName) {
        return ts.isIdentifier(node.name) ? node.name.text : undefined;
      }
      if (
        ts.isIdentifier(node.propertyName) ||
        ts.isStringLiteral(node.propertyName) ||
        ts.isNumericLiteral(node.propertyName)
      ) {
        return node.propertyName.text;
      }
      if (ts.isComputedPropertyName(node.propertyName)) {
        return staticPropertyNames(evaluate(node.propertyName.expression))[0];
      }
      return undefined;
    }
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    return staticPropertyNames(evaluate(node.argumentExpression))[0];
  };
  const memberCapabilities = (base, property, node) => {
    const result = new Set();
    if (property !== undefined && /^\d+$/.test(property)) {
      addCapabilities(result, arrayElementCapabilities(base, Number(property)));
    } else if (
      property === undefined &&
      expandedArrayCapabilities(base).has(ARRAY_VALUE_CAPABILITY)
    ) {
      addCapabilities(result, arrayAllElementCapabilities(base));
    }
    for (const capability of base) {
      if (capability === "global-object" && property === "fetch") {
        result.add("fetch");
      } else if (capability === "reflect-object" && property === "get") {
        result.add("reflect-get");
      } else if (capability === "reflect-object" && property === "apply") {
        result.add("reflect-apply");
      } else if (
        capability === "process-object" &&
        property === "getBuiltinModule"
      ) {
        result.add("get-builtin-module");
      } else if (
        capability === "module-object" &&
        property === "createRequire"
      ) {
        result.add("create-require");
      } else if (
        capability === "child-module" &&
        property &&
        SHELL_METHODS.has(property)
      ) {
        result.add(`child-method:${property}`);
      } else if (capability.startsWith("network-module:")) {
        result.add("network-client");
      } else if (
        capability === "api-request" &&
        (!property || API_REQUEST_METHODS.has(property))
      ) {
        result.add(`api-method:${property ?? "*"}`);
      } else if (
        capability === "browser-context-owner" &&
        property === "newContext"
      ) {
        result.add("browser-context-factory");
      } else if (
        capability === "playwright-module" &&
        property === "APIRequestContext"
      ) {
        result.add("api-request");
      } else if (
        (property === "bind" || property === "call" || property === "apply") &&
        (CALLABLE_CAPABILITIES.has(capability) ||
          capability === "network-client" ||
          capability.startsWith("child-method:") ||
          capability.startsWith("api-method:") ||
          capability === "browser-context-factory" ||
          capability.startsWith("returner:"))
      ) {
        result.add(capability);
      }
    }
    if (
      result.size === 0 &&
      property === "request" &&
      !isDirectZeroArgumentCall(node)
    ) {
      result.add("api-request");
    }
    return result;
  };
  const returnerToken = (node) => {
    const existing = [...returners].find(([, value]) => value.node === node);
    if (existing) return existing[0];
    const token = `returner:${nextReturnerId}`;
    nextReturnerId += 1;
    const expressions = [];
    if (node.body && !ts.isBlock(node.body)) {
      expressions.push(node.body);
    } else if (node.body) {
      const collectReturns = (current) => {
        if (current !== node.body && ts.isFunctionLike(current)) return;
        if (ts.isReturnStatement(current) && current.expression) {
          expressions.push(current.expression);
          return;
        }
        ts.forEachChild(current, collectReturns);
      };
      collectReturns(node.body);
    }
    returners.set(token, { node, expressions });
    return token;
  };
  const reflectedArguments = (node) => {
    const capabilities =
      node instanceof Set ? node : evaluate(unwrapExpression(node));
    const unknown = arrayUnknownElementCapabilities(capabilities);
    const reflected = [...arrayElements(capabilities)]
      .sort(([left], [right]) => left - right)
      .map(([, element]) => unionCapabilities([element, unknown]));
    return reflected.length > 0 ? reflected : unknown.size > 0 ? [unknown] : [];
  };
  const argumentCapabilities = (argument, activeReturners = new Set()) =>
    argument instanceof Set
      ? new Set(argument)
      : evaluate(argument, activeReturners);
  const invokeCapabilities = (
    callees,
    argumentNodes,
    callNode,
    activeReturners,
  ) => {
    const result = new Set();
    for (const callee of callees) {
      if (callee === "reflect-get" && argumentNodes.length >= 2) {
        const properties = staticStrings(
          argumentCapabilities(argumentNodes[1], activeReturners),
        );
        if (properties.length === 0) {
          for (const targetCapability of argumentCapabilities(
            argumentNodes[0],
            activeReturners,
          )) {
            if (targetCapability === "child-module") {
              for (const method of SHELL_METHODS) {
                result.add(`child-method:${method}`);
              }
            }
          }
        } else {
          for (const property of properties) {
            addCapabilities(
              result,
              memberCapabilities(
                argumentCapabilities(argumentNodes[0], activeReturners),
                property,
                callNode,
              ),
            );
          }
        }
      } else if (callee === "reflect-apply" && argumentNodes.length >= 1) {
        const target = argumentCapabilities(argumentNodes[0], activeReturners);
        const reflected = argumentNodes[2]
          ? reflectedArguments(argumentNodes[2])
          : [];
        addCapabilities(
          result,
          invokeCapabilities(target, reflected, callNode, activeReturners),
        );
      } else if (callee === "require" || callee === "get-builtin-module") {
        for (const name of staticStrings(
          argumentCapabilities(argumentNodes[0], activeReturners),
        )) {
          addCapabilities(result, moduleCapabilities(name));
        }
      } else if (callee === "create-require") {
        result.add("require");
      } else if (callee === "api-method:newContext") {
        result.add("api-request");
      } else if (callee === "browser-context-factory") {
        result.add("browser-context");
      } else if (
        callee.startsWith("returner:") &&
        !activeReturners.has(callee)
      ) {
        const nextActive = new Set(activeReturners);
        nextActive.add(callee);
        for (const expression of returners.get(callee)?.expressions ?? []) {
          addCapabilities(result, evaluate(expression, nextActive));
        }
      }
    }
    return result;
  };
  const callInvocations = (node, activeReturners = new Set()) => {
    if (
      isAccessExpression(node.expression) &&
      propertyName(node.expression) === "bind"
    ) {
      return [];
    }
    const callees = evaluate(node.expression, activeReturners);
    if (isAccessExpression(node.expression)) {
      const property = propertyName(node.expression);
      if (property === "call") {
        return [
          {
            callees: evaluate(node.expression.expression, activeReturners),
            arguments: [...node.arguments].slice(1),
          },
        ];
      }
      if (
        property === "apply" &&
        !evaluate(node.expression.expression, activeReturners).has(
          "reflect-object",
        )
      ) {
        return [
          {
            callees: evaluate(node.expression.expression, activeReturners),
            arguments: node.arguments[1]
              ? reflectedArguments(node.arguments[1])
              : [],
          },
        ];
      }
    }
    if (callees.has("reflect-apply") && node.arguments[0]) {
      return [
        {
          callees: evaluate(node.arguments[0], activeReturners),
          arguments: node.arguments[2]
            ? reflectedArguments(node.arguments[2])
            : [],
        },
      ];
    }
    return [{ callees, arguments: [...node.arguments] }];
  };
  const evaluate = (input, activeReturners = new Set()) => {
    if (!input) return new Set();
    const node = unwrapExpression(input);
    const scope = scopeForNode.get(node) ?? rootScope;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return new Set([stringCapability(node.text)]);
    }
    if (ts.isNumericLiteral(node)) {
      return new Set([numberCapability(node.text)]);
    }
    if (ts.isArrayLiteralExpression(node)) {
      const reference = arrayReferenceCapability(node);
      const state = arrayStates.get(parseArrayReferenceCapability(reference));
      const result = new Set([ARRAY_VALUE_CAPABILITY, reference]);
      let index = 0;
      for (const element of node.elements) {
        if (ts.isOmittedExpression(element)) {
          index += 1;
          continue;
        }
        if (ts.isSpreadElement(element)) {
          const spreadElements = arrayElements(
            evaluate(element.expression, activeReturners),
          );
          const ordered = [...spreadElements].sort(
            ([left], [right]) => left - right,
          );
          for (const [, capabilities] of ordered) {
            for (const capability of capabilities) {
              result.add(arrayElementCapability(index, capability));
            }
            index += 1;
          }
          for (const capability of arrayUnknownElementCapabilities(
            evaluate(element.expression, activeReturners),
          )) {
            result.add(arrayUnknownElementCapability(capability));
          }
          continue;
        }
        for (const capability of evaluate(element, activeReturners)) {
          result.add(arrayElementCapability(index, capability));
        }
        index += 1;
      }
      addCapabilities(state, result);
      return result;
    }
    if (ts.isIdentifier(node)) {
      const binding = resolveBinding(node.text, scope);
      return binding
        ? new Set(binding.capabilities)
        : builtinCapabilities(node.text, scope);
    }
    if (
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node)
    ) {
      return new Set([returnerToken(node)]);
    }
    if (isAccessExpression(node)) {
      return memberCapabilities(
        evaluate(node.expression, activeReturners),
        propertyName(node),
        node,
      );
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const names = staticStrings(
          evaluate(node.arguments[0], activeReturners),
        );
        return unionCapabilities(names.map(moduleCapabilities));
      }
      if (
        isAccessExpression(node.expression) &&
        propertyName(node.expression) === "bind"
      ) {
        return evaluate(node.expression.expression, activeReturners);
      }
      const result = new Set();
      for (const invocation of callInvocations(node, activeReturners)) {
        addCapabilities(
          result,
          invokeCapabilities(
            invocation.callees,
            invocation.arguments,
            node,
            activeReturners,
          ),
        );
      }
      return result;
    }
    if (ts.isAwaitExpression(node) || ts.isYieldExpression(node)) {
      return evaluate(node.expression, activeReturners);
    }
    if (ts.isConditionalExpression(node)) {
      return unionCapabilities([
        evaluate(node.whenTrue, activeReturners),
        evaluate(node.whenFalse, activeReturners),
      ]);
    }
    if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = staticStrings(evaluate(node.left, activeReturners));
        const right = staticStrings(evaluate(node.right, activeReturners));
        return new Set(
          left.flatMap((leftValue) =>
            right.map((rightValue) => stringCapability(leftValue + rightValue)),
          ),
        );
      }
      if (node.operatorToken.kind === ts.SyntaxKind.CommaToken) {
        return evaluate(node.right, activeReturners);
      }
    }
    return new Set();
  };
  const assignPattern = (pattern, capabilities, scope) => {
    let changed = false;
    if (ts.isIdentifier(pattern)) {
      const binding = resolveBinding(pattern.text, scope);
      return binding
        ? addCapabilities(binding.capabilities, capabilities)
        : false;
    }
    if (ts.isObjectBindingPattern(pattern)) {
      for (const element of pattern.elements) {
        if (element.dotDotDotToken) {
          changed = assignPattern(element.name, capabilities, scope) || changed;
          continue;
        }
        const property = propertyName(element);
        let member = memberCapabilities(capabilities, property, element);
        if (property === "request" && member.size === 0) {
          member = new Set(["api-request"]);
        }
        if (element.initializer) {
          member = unionCapabilities([member, evaluate(element.initializer)]);
        }
        changed = assignPattern(element.name, member, scope) || changed;
      }
    } else if (ts.isObjectLiteralExpression(pattern)) {
      for (const property of pattern.properties) {
        if (ts.isPropertyAssignment(property)) {
          const name = objectPropertyName(property.name);
          const member = memberCapabilities(capabilities, name, property);
          changed =
            assignPattern(property.initializer, member, scope) || changed;
        } else if (ts.isShorthandPropertyAssignment(property)) {
          const member = memberCapabilities(
            capabilities,
            property.name.text,
            property,
          );
          changed = assignPattern(property.name, member, scope) || changed;
        } else if (ts.isSpreadAssignment(property)) {
          changed =
            assignPattern(property.expression, capabilities, scope) || changed;
        }
      }
    } else if (ts.isArrayLiteralExpression(pattern)) {
      for (let index = 0; index < pattern.elements.length; index += 1) {
        const element = pattern.elements[index];
        if (ts.isSpreadElement(element)) {
          changed =
            assignPattern(
              element.expression,
              arrayRestCapabilities(capabilities, index),
              scope,
            ) || changed;
          continue;
        }
        changed =
          assignPattern(
            element,
            arrayElementCapabilities(capabilities, index),
            scope,
          ) || changed;
      }
    } else if (ts.isArrayBindingPattern(pattern)) {
      for (let index = 0; index < pattern.elements.length; index += 1) {
        const element = pattern.elements[index];
        if (ts.isBindingElement(element)) {
          const value = element.dotDotDotToken
            ? arrayRestCapabilities(capabilities, index)
            : arrayElementCapabilities(capabilities, index);
          changed = assignPattern(element.name, value, scope) || changed;
        }
      }
    }
    return changed;
  };
  const objectPropertyName = (name) => {
    if (
      ts.isIdentifier(name) ||
      ts.isStringLiteral(name) ||
      ts.isNumericLiteral(name)
    ) {
      return name.text;
    }
    return staticPropertyNames(evaluate(name.expression))[0];
  };
  const addAssignment = (pattern, expression, scope) => {
    assignments.push(() => assignPattern(pattern, evaluate(expression), scope));
  };
  const isApiRequestContextType = (node) =>
    node &&
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    node.typeName.text === "APIRequestContext";
  const ensureAssignmentTarget = (pattern, scope) => {
    if (ts.isIdentifier(pattern)) {
      if (!resolveBinding(pattern.text, scope)) {
        declare(
          variableScope(scope, { flags: ts.NodeFlags.None }),
          pattern.text,
          pattern,
        );
      }
      return;
    }
    if (ts.isObjectLiteralExpression(pattern)) {
      for (const property of pattern.properties) {
        if (ts.isPropertyAssignment(property)) {
          ensureAssignmentTarget(property.initializer, scope);
        } else if (ts.isShorthandPropertyAssignment(property)) {
          ensureAssignmentTarget(property.name, scope);
        } else if (ts.isSpreadAssignment(property)) {
          ensureAssignmentTarget(property.expression, scope);
        }
      }
    } else if (ts.isArrayLiteralExpression(pattern)) {
      for (const element of pattern.elements) {
        ensureAssignmentTarget(element, scope);
      }
    }
  };
  const collectAssignments = (node) => {
    const scope = scopeForNode.get(node) ?? rootScope;
    if (ts.isVariableDeclaration(node)) {
      if (node.initializer) {
        addAssignment(node.name, node.initializer, scope);
      }
      if (isApiRequestContextType(node.type)) {
        assignments.push(() =>
          assignPattern(node.name, new Set(["api-request"]), scope),
        );
      }
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      if (
        ts.isElementAccessExpression(node.left) &&
        node.left.argumentExpression
      ) {
        assignments.push(() => {
          const base = evaluate(node.left.expression);
          const values = evaluate(node.right);
          const indices = staticPropertyNames(
            evaluate(node.left.argumentExpression),
          )
            .filter((value) => /^\d+$/.test(value))
            .map(Number);
          const additions = new Set([ARRAY_VALUE_CAPABILITY]);
          for (const capability of values) {
            if (indices.length > 0) {
              for (const index of indices) {
                additions.add(arrayElementCapability(index, capability));
              }
            } else {
              additions.add(arrayUnknownElementCapability(capability));
            }
          }
          let changed = false;
          for (const capability of base) {
            const reference = parseArrayReferenceCapability(capability);
            if (reference === undefined) continue;
            changed =
              addCapabilities(arrayStates.get(reference), additions) || changed;
          }
          if (ts.isIdentifier(node.left.expression)) {
            const binding = resolveBinding(node.left.expression.text, scope);
            if (binding) {
              changed =
                addCapabilities(binding.capabilities, additions) || changed;
            }
          }
          return changed;
        });
      } else {
        ensureAssignmentTarget(node.left, scope);
        addAssignment(node.left, node.right, scope);
      }
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      addAssignment(node.name, node, scope);
    } else if (ts.isParameter(node)) {
      if (isApiRequestContextType(node.type)) {
        assignments.push(() =>
          assignPattern(node.name, new Set(["api-request"]), scope),
        );
      }
      if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (propertyName(element) === "request") {
            assignments.push(() =>
              assignPattern(element.name, new Set(["api-request"]), scope),
            );
          } else if (propertyName(element) === "browser") {
            assignments.push(() =>
              assignPattern(
                element.name,
                new Set(["browser-context-owner"]),
                scope,
              ),
            );
          }
        }
      }
    } else if (ts.isImportDeclaration(node) && node.importClause) {
      const moduleName = ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : undefined;
      if (moduleName) {
        const moduleValue = moduleCapabilities(moduleName);
        if (node.importClause.name && !node.importClause.isTypeOnly) {
          assignments.push(() =>
            assignPattern(node.importClause.name, moduleValue, scope),
          );
        }
        const bindings = node.importClause.namedBindings;
        if (
          bindings &&
          ts.isNamespaceImport(bindings) &&
          !node.importClause.isTypeOnly
        ) {
          assignments.push(() =>
            assignPattern(bindings.name, moduleValue, scope),
          );
        } else if (bindings) {
          for (const specifier of bindings.elements) {
            if (node.importClause.isTypeOnly || specifier.isTypeOnly) continue;
            const imported =
              specifier.propertyName?.text ?? specifier.name.text;
            let value = memberCapabilities(moduleValue, imported, specifier);
            if (moduleName === "@playwright/test" && imported === "request") {
              value = new Set(["api-request"]);
            }
            assignments.push(() => assignPattern(specifier.name, value, scope));
          }
        }
      }
    }
    if (ts.isCallExpression(node)) {
      assignments.push(() => {
        let changed = false;
        for (const invocation of callInvocations(node)) {
          for (const callee of invocation.callees) {
            if (!callee.startsWith("returner:")) continue;
            const functionNode = returners.get(callee)?.node;
            if (!functionNode) continue;
            for (
              let index = 0;
              index < functionNode.parameters.length;
              index += 1
            ) {
              const parameter = functionNode.parameters[index];
              const argument =
                invocation.arguments[index] ?? parameter.initializer;
              changed =
                assignPattern(
                  parameter.name,
                  argumentCapabilities(argument),
                  scopeForNode.get(parameter) ?? rootScope,
                ) || changed;
            }
          }
        }
        return changed;
      });
    }
    ts.forEachChild(node, collectAssignments);
  };
  collectAssignments(sourceFile);
  while (true) {
    let changed = false;
    for (const assignment of assignments) {
      changed = assignment() || changed;
    }
    if (!changed) break;
  }

  const shellCommand = (nodes) => {
    const values = [];
    const collect = (node) => {
      values.push(...staticStrings(evaluate(node)));
      for (const element of arrayElements(evaluate(node)).values()) {
        values.push(...staticStrings(element));
      }
      if (ts.isArrayLiteralExpression(node)) {
        for (const element of node.elements) collect(element);
      } else if (ts.isTemplateExpression(node)) {
        values.push(node.head.text);
        for (const span of node.templateSpans) values.push(span.literal.text);
      }
    };
    for (const node of nodes) collect(node);
    const match = values
      .join(" ")
      .match(
        /(?:^|[\s;&|()/\\])((?:curl|wget|http|https|httpie))(?=$|[\s;&|()/\\])/i,
      );
    return match?.[1]?.toLowerCase();
  };
  const invokedCapabilities = (node) => {
    const result = new Set();
    for (const invocation of callInvocations(node)) {
      addCapabilities(result, invocation.callees);
    }
    return result;
  };

  return {
    bindingForIdentifier: (node) =>
      ts.isIdentifier(node)
        ? resolveBinding(node.text, scopeForNode.get(node) ?? rootScope)
        : undefined,
    bindingReports,
    evaluate,
    invokedCapabilities,
    propertyName,
    shellCommand,
  };
}

function unionCapabilities(capabilitySets) {
  const result = new Set();
  for (const capabilities of capabilitySets) {
    for (const capability of capabilities) result.add(capability);
  }
  return result;
}

function hasCapability(capabilities, expected) {
  return capabilities.has(expected);
}

function hasCapabilityPrefix(capabilities, prefix) {
  return [...capabilities].some((capability) => capability.startsWith(prefix));
}

function createCredentialHelperApproval(filePath, sourceFile, analysis) {
  if (filePath !== CREDENTIAL_REQUEST_WRAPPER) return () => false;

  const approvedNodes = new Set();
  const findTopLevelFunction = (name) =>
    sourceFile.statements.find(
      (statement) =>
        ts.isFunctionDeclaration(statement) && statement.name?.text === name,
    );
  const findImportSpecifier = (
    moduleName,
    importedName,
    requireMatchingLocalName = true,
  ) => {
    for (const statement of sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== moduleName
      ) {
        continue;
      }
      for (const specifier of statement.importClause?.namedBindings?.elements ??
        []) {
        const imported = specifier.propertyName?.text ?? specifier.name.text;
        if (
          imported === importedName &&
          (!requireMatchingLocalName || specifier.name.text === importedName)
        ) {
          return specifier;
        }
      }
    }
    return undefined;
  };
  const isTypeOnlyImportSpecifier = (specifier) =>
    Boolean(
      specifier &&
      (specifier.isTypeOnly ||
        findAncestor(specifier, ts.isImportClause)?.isTypeOnly),
    );
  const sameBinding = (left, right) =>
    sameAnalysisBinding(left, right?.name ?? right, analysis);
  const approve = (...nodes) => {
    for (const node of nodes) {
      if (node) approvedNodes.add(node);
    }
  };

  const requestImport = findImportSpecifier("@playwright/test", "request");
  const apiRequestContextImport = findImportSpecifier(
    "@playwright/test",
    "APIRequestContext",
    false,
  );
  const gateImport = findImportSpecifier(
    "./profile-credential-gate",
    "assertProfileCredentialGate",
  );
  const optionsSanitizer = findTopLevelFunction(
    "sanitizeCredentialGatedOptions",
  );
  const credentialGatedRequest = findTopLevelFunction("credentialGatedRequest");
  const ownerParameter = credentialGatedRequest?.parameters.find(
    (parameter) =>
      ts.isIdentifier(parameter.name) && parameter.name.text === "owner",
  );
  const executeUnauthenticatedRequest = findTopLevelFunction(
    "executeUnauthenticatedRequest",
  );
  const methodParameter = executeUnauthenticatedRequest?.parameters.find(
    (parameter) =>
      ts.isIdentifier(parameter.name) && parameter.name.text === "method",
  );
  const argsParameter = executeUnauthenticatedRequest?.parameters.find(
    (parameter) =>
      ts.isIdentifier(parameter.name) && parameter.name.text === "args",
  );

  if (requestImport) approve(requestImport);
  if (
    apiRequestContextImport &&
    isTypeOnlyImportSpecifier(apiRequestContextImport)
  ) {
    approve(apiRequestContextImport);
  }

  if (
    credentialGatedRequest?.body &&
    ownerParameter &&
    gateImport &&
    ts.isBlock(credentialGatedRequest.body) &&
    !hasBindingWrite(credentialGatedRequest, ownerParameter.name, analysis) &&
    !hasBindingWrite(sourceFile, gateImport.name, analysis)
  ) {
    const returnStatement = credentialGatedRequest.body.statements.find(
      ts.isReturnStatement,
    );
    const facade =
      returnStatement?.expression &&
      ts.isObjectLiteralExpression(returnStatement.expression)
        ? returnStatement.expression
        : undefined;
    for (const property of facade?.properties ?? []) {
      approveCredentialFacadeProperty({
        analysis,
        approve,
        gateImport,
        optionsSanitizer,
        ownerParameter,
        property,
      });
    }
  }

  const isolatedContext = findIsolatedContextDeclaration(
    executeUnauthenticatedRequest,
    requestImport,
    analysis,
  );
  if (
    isolatedContext &&
    hasOnlyApprovedIsolatedContextReferences({
      analysis,
      context: isolatedContext,
      executeUnauthenticatedRequest,
      methodParameter,
    })
  ) {
    const newContextCall = unwrapExpression(
      unwrapExpression(isolatedContext.initializer).expression,
    );
    approve(
      isolatedContext,
      isolatedContext.name,
      newContextCall,
      newContextCall.expression,
    );
    const visit = (node) => {
      if (
        isAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        sameBinding(node.expression, isolatedContext)
      ) {
        const property = directPropertyName(node);
        if (
          property === "dispose" ||
          (ts.isElementAccessExpression(node) &&
            ts.isIdentifier(node.argumentExpression) &&
            sameBinding(node.argumentExpression, methodParameter))
        ) {
          approve(node, node.parent);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(executeUnauthenticatedRequest);
  }

  const isApprovedFacadeTypeReference = (typeReference) => {
    const typeAlias = findAncestor(typeReference, ts.isTypeAliasDeclaration);
    if (!typeAlias) return false;
    if (typeAlias.name.text === "E2EApiRequest") {
      const pick = typeReference.parent;
      return (
        ts.isTypeReferenceNode(pick) &&
        ts.isIdentifier(pick.typeName) &&
        pick.typeName.text === "Pick" &&
        pick.typeArguments?.[0] === typeReference
      );
    }
    if (typeAlias.name.text === "UnauthenticatedE2EApiRequest") {
      const indexedAccess = findAncestor(
        typeReference,
        ts.isIndexedAccessTypeNode,
      );
      const parameters = indexedAccess?.parent;
      const indexType = indexedAccess?.indexType;
      return (
        indexedAccess?.objectType === typeReference &&
        indexType &&
        ts.isLiteralTypeNode(indexType) &&
        ts.isStringLiteral(indexType.literal) &&
        (indexType.literal.text === "get" ||
          indexType.literal.text === "head") &&
        parameters &&
        ts.isTypeReferenceNode(parameters) &&
        ts.isIdentifier(parameters.typeName) &&
        parameters.typeName.text === "Parameters" &&
        parameters.typeArguments?.[0] === indexedAccess
      );
    }
    return false;
  };

  return (node, rule) => {
    if (rule !== "raw-api-request-context") return false;
    if (approvedNodes.has(node)) return true;
    const importSpecifier = ts.isImportSpecifier(node)
      ? node
      : findAncestor(node, ts.isImportSpecifier);
    if (
      importSpecifier &&
      (importSpecifier === requestImport ||
        (importSpecifier === apiRequestContextImport &&
          isTypeOnlyImportSpecifier(importSpecifier)))
    ) {
      return true;
    }

    if (
      ts.isIdentifier(node) &&
      node.text === "APIRequestContext" &&
      sameBinding(node, apiRequestContextImport)
    ) {
      const typeReference = findAncestor(node, ts.isTypeReferenceNode);
      if (typeReference && isApprovedFacadeTypeReference(typeReference)) {
        return true;
      }
      if (
        typeReference &&
        ((isolatedContext?.type &&
          isNodeWithin(typeReference, isolatedContext.type)) ||
          (argsParameter?.type &&
            isNodeWithin(typeReference, argsParameter.type)))
      ) {
        return true;
      }
    }
    return false;
  };
}

function approveCredentialFacadeProperty({
  analysis,
  approve,
  gateImport,
  optionsSanitizer,
  ownerParameter,
  property,
}) {
  if (
    !ts.isPropertyAssignment(property) ||
    !ts.isIdentifier(property.name) ||
    !API_OPERATION_METHODS.has(property.name.text) ||
    !ts.isArrowFunction(property.initializer) ||
    !property.initializer.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
    ) ||
    !ts.isBlock(property.initializer.body) ||
    ![4, 5].includes(property.initializer.body.statements.length) ||
    property.initializer.parameters.length !== 1 ||
    !property.initializer.parameters[0].dotDotDotToken ||
    !ts.isIdentifier(property.initializer.parameters[0].name) ||
    property.initializer.parameters[0].name.text !== "args" ||
    !optionsSanitizer?.name ||
    !hasSingleBindingDeclaration(gateImport.name, analysis) ||
    !hasSingleBindingDeclaration(ownerParameter.name, analysis) ||
    !hasSingleBindingDeclaration(optionsSanitizer.name, analysis)
  ) {
    return;
  }
  const argsParameter = property.initializer.parameters[0];

  const statements = property.initializer.body.statements;
  const secureChannelContract =
    statements.length === 5 && ts.isVariableStatement(statements[0]);
  const tlsChannelContract =
    statements.length === 5 && ts.isExpressionStatement(statements[0]);
  const gateStatement = statements[0];
  const optionsStatement =
    statements[secureChannelContract || tlsChannelContract ? 1 : 2];
  const contextStatement =
    statements[secureChannelContract || tlsChannelContract ? 3 : 1];
  const requestStatement =
    statements[secureChannelContract || tlsChannelContract ? 4 : 3];
  let gateCall;
  let capability;
  if (secureChannelContract) {
    if (
      !ts.isVariableStatement(gateStatement) ||
      !(gateStatement.declarationList.flags & ts.NodeFlags.Const) ||
      gateStatement.declarationList.declarations.length !== 1
    ) {
      return;
    }
    capability = gateStatement.declarationList.declarations[0];
    const awaited = unwrapExpression(capability.initializer);
    gateCall =
      awaited && ts.isAwaitExpression(awaited)
        ? unwrapExpression(awaited.expression)
        : undefined;
  } else {
    if (
      !ts.isExpressionStatement(gateStatement) ||
      !ts.isAwaitExpression(unwrapExpression(gateStatement.expression))
    ) {
      return;
    }
    gateCall = unwrapExpression(
      unwrapExpression(gateStatement.expression).expression,
    );
  }
  if (
    !gateCall ||
    !ts.isCallExpression(gateCall) ||
    gateCall.arguments.length !== 0 ||
    !ts.isIdentifier(gateCall.expression) ||
    !sameAnalysisBinding(gateCall.expression, gateImport.name, analysis)
  ) {
    return;
  }
  if (secureChannelContract) {
    const secureBranch = statements[2];
    if (
      !capability ||
      !ts.isIdentifier(capability.name) ||
      capability.name.text !== "capability" ||
      !ts.isIfStatement(secureBranch) ||
      !ts.isIdentifier(secureBranch.expression) ||
      !sameAnalysisBinding(
        secureBranch.expression,
        capability.name,
        analysis,
      ) ||
      !ts.isReturnStatement(secureBranch.thenStatement)
    ) {
      return;
    }
    const secureCall = unwrapExpression(secureBranch.thenStatement.expression);
    if (
      !ts.isCallExpression(secureCall) ||
      !ts.isIdentifier(secureCall.expression) ||
      secureCall.expression.text !== "executeVerified" ||
      secureCall.arguments.length !== 4 ||
      !ts.isStringLiteral(secureCall.arguments[0]) ||
      secureCall.arguments[0].text !== property.name.text ||
      !ts.isIdentifier(secureCall.arguments[1]) ||
      !sameAnalysisBinding(
        secureCall.arguments[1],
        argsParameter.name,
        analysis,
      ) ||
      !ts.isIdentifier(secureCall.arguments[2]) ||
      !sameAnalysisBinding(secureCall.arguments[2], capability.name, analysis)
    ) {
      return;
    }
  } else if (tlsChannelContract) {
    const secureBranch = statements[2];
    const secureCall =
      ts.isIfStatement(secureBranch) &&
      ts.isReturnStatement(secureBranch.thenStatement)
        ? unwrapExpression(secureBranch.thenStatement.expression)
        : undefined;
    if (
      !secureCall ||
      !ts.isCallExpression(secureCall) ||
      !ts.isIdentifier(secureCall.expression) ||
      secureCall.expression.text !== "executeVerified" ||
      secureCall.arguments.length !== 3 ||
      !ts.isStringLiteral(secureCall.arguments[0]) ||
      secureCall.arguments[0].text !== property.name.text ||
      !ts.isIdentifier(secureCall.arguments[1]) ||
      !sameAnalysisBinding(
        secureCall.arguments[1],
        argsParameter.name,
        analysis,
      ) ||
      !ts.isIdentifier(secureCall.arguments[2]) ||
      secureCall.arguments[2].text !== "options"
    ) {
      return;
    }
  }

  if (
    !ts.isVariableStatement(contextStatement) ||
    !(contextStatement.declarationList.flags & ts.NodeFlags.Const) ||
    contextStatement.declarationList.declarations.length !== 1
  ) {
    return;
  }
  const context = contextStatement.declarationList.declarations[0];
  const ownerRequest = unwrapExpression(context.initializer);
  if (
    !ts.isIdentifier(context.name) ||
    context.name.text !== "context" ||
    !ownerRequest ||
    !isAccessExpression(ownerRequest) ||
    directPropertyName(ownerRequest) !== "request" ||
    !ts.isIdentifier(ownerRequest.expression) ||
    !sameAnalysisBinding(
      ownerRequest.expression,
      ownerParameter.name,
      analysis,
    ) ||
    !hasSingleBindingDeclaration(context.name, analysis)
  ) {
    return;
  }

  if (
    !ts.isVariableStatement(optionsStatement) ||
    !(optionsStatement.declarationList.flags & ts.NodeFlags.Const) ||
    optionsStatement.declarationList.declarations.length !== 1
  ) {
    return;
  }
  const options = optionsStatement.declarationList.declarations[0];
  const optionsCall = unwrapExpression(options.initializer);
  const optionsArgument = optionsCall?.arguments?.[0];
  if (
    !ts.isIdentifier(options.name) ||
    options.name.text !== "options" ||
    !ts.isCallExpression(optionsCall) ||
    optionsCall.arguments.length !== 1 ||
    !ts.isIdentifier(optionsCall.expression) ||
    !sameAnalysisBinding(
      optionsCall.expression,
      optionsSanitizer.name,
      analysis,
    ) ||
    !optionsArgument ||
    !ts.isElementAccessExpression(optionsArgument) ||
    !ts.isIdentifier(optionsArgument.expression) ||
    !sameAnalysisBinding(
      optionsArgument.expression,
      argsParameter.name,
      analysis,
    ) ||
    !ts.isNumericLiteral(optionsArgument.argumentExpression) ||
    optionsArgument.argumentExpression.text !== "1" ||
    !hasSingleBindingDeclaration(options.name, analysis) ||
    hasBindingWrite(property.initializer, argsParameter.name, analysis)
  ) {
    return;
  }

  if (!ts.isReturnStatement(requestStatement) || !requestStatement.expression) {
    return;
  }
  const requestCall = unwrapExpression(requestStatement.expression);
  if (
    !ts.isCallExpression(requestCall) ||
    !isAccessExpression(requestCall.expression) ||
    directPropertyName(requestCall.expression) !== property.name.text ||
    !ts.isIdentifier(requestCall.expression.expression) ||
    !sameAnalysisBinding(
      requestCall.expression.expression,
      context.name,
      analysis,
    ) ||
    requestCall.arguments.length !== 2 ||
    !isArgsElement(
      requestCall.arguments[0],
      argsParameter.name,
      "0",
      analysis,
    ) ||
    !isCredentialGatedRequestOptions(
      requestCall.arguments[1],
      options.name,
      analysis,
    )
  ) {
    return;
  }

  approve(
    gateCall,
    capability,
    capability?.name,
    context,
    context.name,
    ownerRequest,
    options,
    options.name,
    optionsCall,
    optionsCall.expression,
    requestCall,
    requestCall.expression,
  );
}

function isArgsElement(node, argsIdentifier, index, analysis) {
  const expression = unwrapExpression(node);
  return (
    ts.isElementAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    sameAnalysisBinding(expression.expression, argsIdentifier, analysis) &&
    ts.isNumericLiteral(expression.argumentExpression) &&
    expression.argumentExpression.text === index
  );
}

function isCredentialGatedRequestOptions(node, optionsIdentifier, analysis) {
  const expression = unwrapExpression(node);
  if (
    !ts.isObjectLiteralExpression(expression) ||
    expression.properties.length !== 2
  ) {
    return false;
  }
  const [spread, redirect] = expression.properties;
  return (
    ts.isSpreadAssignment(spread) &&
    ts.isIdentifier(spread.expression) &&
    sameAnalysisBinding(spread.expression, optionsIdentifier, analysis) &&
    ts.isPropertyAssignment(redirect) &&
    ((ts.isIdentifier(redirect.name) &&
      redirect.name.text === "maxRedirects") ||
      (ts.isStringLiteral(redirect.name) &&
        redirect.name.text === "maxRedirects")) &&
    ts.isNumericLiteral(redirect.initializer) &&
    redirect.initializer.text === "0"
  );
}

function findIsolatedContextDeclaration(container, requestImport, analysis) {
  if (
    !container ||
    !requestImport ||
    !hasSingleBindingDeclaration(requestImport.name, analysis)
  ) {
    return undefined;
  }
  const candidates = [];
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "context" &&
      isConstVariableDeclaration(node) &&
      isApprovedRequestNewContext(node.initializer, requestImport, analysis)
    ) {
      candidates.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(container);
  return candidates.length === 1 ? candidates[0] : undefined;
}

function hasOnlyApprovedIsolatedContextReferences({
  analysis,
  context,
  executeUnauthenticatedRequest,
  methodParameter,
}) {
  if (
    !methodParameter ||
    !hasSingleBindingDeclaration(context.name, analysis) ||
    !hasSingleBindingDeclaration(methodParameter.name, analysis) ||
    hasBindingWrite(executeUnauthenticatedRequest, context.name, analysis) ||
    hasBindingWrite(
      executeUnauthenticatedRequest,
      methodParameter.name,
      analysis,
    )
  ) {
    return false;
  }

  const contextStatement = findAncestor(context, ts.isVariableStatement);
  const functionBody = executeUnauthenticatedRequest?.body;
  if (
    !contextStatement ||
    !functionBody ||
    !ts.isBlock(functionBody) ||
    contextStatement.parent !== functionBody
  ) {
    return false;
  }
  const contextIndex = functionBody.statements.indexOf(contextStatement);
  const cleanupTry = functionBody.statements[contextIndex + 1];
  if (
    contextIndex < 0 ||
    !cleanupTry ||
    !ts.isTryStatement(cleanupTry) ||
    !cleanupTry.finallyBlock ||
    cleanupTry.finallyBlock.statements.length !== 1
  ) {
    return false;
  }
  const cleanupStatement = cleanupTry.finallyBlock.statements[0];
  if (
    !ts.isExpressionStatement(cleanupStatement) ||
    !ts.isAwaitExpression(cleanupStatement.expression)
  ) {
    return false;
  }
  const cleanupCall = cleanupStatement.expression.expression;
  if (
    !ts.isCallExpression(cleanupCall) ||
    cleanupCall.questionDotToken ||
    cleanupCall.typeArguments?.length ||
    cleanupCall.arguments.length !== 0 ||
    !ts.isPropertyAccessExpression(cleanupCall.expression) ||
    cleanupCall.expression.questionDotToken ||
    cleanupCall.expression.name.text !== "dispose" ||
    !ts.isIdentifier(cleanupCall.expression.expression) ||
    !sameAnalysisBinding(
      cleanupCall.expression.expression,
      context.name,
      analysis,
    )
  ) {
    return false;
  }

  let requestOperation;
  let approved = true;
  const visit = (node) => {
    if (
      ts.isIdentifier(node) &&
      sameAnalysisBinding(node, context.name, analysis)
    ) {
      if (node === context.name) {
        // The immutable declaration establishes provenance.
      } else if (
        isAccessExpression(node.parent) &&
        node.parent.expression === node &&
        ts.isCallExpression(node.parent.parent) &&
        node.parent.parent.expression === node.parent
      ) {
        const property = directPropertyName(node.parent);
        if (property === "dispose" && node.parent.parent === cleanupCall) {
          // The sole direct statement in the mandatory finally is awaited.
        } else if (
          ts.isElementAccessExpression(node.parent) &&
          ts.isIdentifier(node.parent.argumentExpression) &&
          sameAnalysisBinding(
            node.parent.argumentExpression,
            methodParameter.name,
            analysis,
          )
        ) {
          if (isNodeWithin(node.parent, cleanupTry.tryBlock)) {
            requestOperation = node.parent.parent;
          } else {
            approved = false;
          }
        } else {
          approved = false;
        }
      } else {
        approved = false;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(executeUnauthenticatedRequest);
  return approved && Boolean(requestOperation);
}

function hasSingleBindingDeclaration(identifier, analysis) {
  const binding = analysis.bindingForIdentifier(identifier);
  return Boolean(binding && binding.declarations.size === 1);
}

function hasBindingWrite(container, declarationIdentifier, analysis) {
  let found = false;
  const containsBinding = (node) => {
    if (
      ts.isIdentifier(node) &&
      sameAnalysisBinding(node, declarationIdentifier, analysis)
    ) {
      return true;
    }
    return node.getChildren().some(containsBinding);
  };
  const visit = (node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      containsBinding(node.left)
    ) {
      found = true;
      return;
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      containsBinding(node.operand)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(container);
  return found;
}

function isNodeWithin(node, container) {
  if (!container) return false;
  for (let current = node; current; current = current.parent) {
    if (current === container) return true;
  }
  return false;
}

function isConstVariableDeclaration(declaration) {
  return Boolean(
    declaration &&
    ts.isVariableDeclarationList(declaration.parent) &&
    declaration.parent.flags & ts.NodeFlags.Const,
  );
}

function sameAnalysisBinding(left, right, analysis) {
  return Boolean(
    left &&
    right &&
    ts.isIdentifier(left) &&
    ts.isIdentifier(right) &&
    analysis.bindingForIdentifier(left) !== undefined &&
    analysis.bindingForIdentifier(left) ===
      analysis.bindingForIdentifier(right),
  );
}

function directAccessExpression(node) {
  if (isAccessExpression(node)) return node;
  if (ts.isCallExpression(node) && isAccessExpression(node.expression)) {
    return node.expression;
  }
  return undefined;
}

function directPropertyName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  const argument = unwrapExpression(node.argumentExpression);
  if (
    ts.isStringLiteral(argument) ||
    ts.isNoSubstitutionTemplateLiteral(argument) ||
    ts.isNumericLiteral(argument)
  ) {
    return argument.text;
  }
  return undefined;
}

function isApprovedRequestNewContext(node, requestImport, analysis) {
  if (!requestImport) return false;
  const expression = node;
  if (!ts.isAwaitExpression(expression)) return false;
  const call = expression.expression;
  if (
    !ts.isCallExpression(call) ||
    call.questionDotToken ||
    call.typeArguments?.length ||
    !ts.isPropertyAccessExpression(call.expression) ||
    call.expression.questionDotToken ||
    call.arguments.length !== 1 ||
    !ts.isObjectLiteralExpression(unwrapExpression(call.arguments[0]))
  ) {
    return false;
  }
  const options = unwrapExpression(call.arguments[0]);
  const storageState = options.properties.find(
    (property) =>
      ts.isPropertyAssignment(property) &&
      staticPropertyName(property.name) === "storageState",
  );
  if (
    !storageState ||
    !ts.isPropertyAssignment(storageState) ||
    !isEmptyPlaywrightStorageState(storageState.initializer) ||
    options.properties.some((property) => {
      const name = staticPropertyName(property.name);
      return name === "httpCredentials" || name === "clientCertificates";
    })
  ) {
    return false;
  }
  return (
    call.expression.name.text === "newContext" &&
    ts.isIdentifier(call.expression.expression) &&
    analysis.bindingForIdentifier(call.expression.expression) ===
      analysis.bindingForIdentifier(requestImport.name)
  );
}

function isEmptyPlaywrightStorageState(node) {
  const value = unwrapExpression(node);
  if (!ts.isObjectLiteralExpression(value) || value.properties.length !== 2) {
    return false;
  }
  const emptyArrays = new Set();
  for (const property of value.properties) {
    if (
      !ts.isPropertyAssignment(property) ||
      !ts.isArrayLiteralExpression(unwrapExpression(property.initializer)) ||
      unwrapExpression(property.initializer).elements.length !== 0
    ) {
      return false;
    }
    emptyArrays.add(staticPropertyName(property.name));
  }
  return emptyArrays.has("cookies") && emptyArrays.has("origins");
}

function staticPropertyName(node) {
  if (
    ts.isIdentifier(node) ||
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isNumericLiteral(node)
  ) {
    return node.text;
  }
  if (ts.isComputedPropertyName(node)) {
    const expression = unwrapExpression(node.expression);
    if (
      ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression) ||
      ts.isNumericLiteral(expression)
    ) {
      return expression.text;
    }
  }
  return undefined;
}

function findAncestor(node, predicate) {
  for (let current = node.parent; current; current = current.parent) {
    if (predicate(current)) return current;
  }
  return undefined;
}

export function scanGovernance(repoRoot = process.cwd()) {
  return scanRepositoryRoots({
    repoRoot,
    roots: ["e2e", "src", "scripts"],
    sourceExtensions: SOURCE_EXTENSIONS,
    scanText,
  });
}

function main() {
  const findings = scanGovernance();
  if (findings.length === 0) {
    console.log("E2E governance guard passed.");
    return;
  }

  console.error("E2E governance guard failed:");
  for (const item of findings) {
    console.error(
      `${item.filePath}:${item.lineNumber}:${item.columnNumber} ${item.rule} ${item.match} — use shared builders/readiness helpers or add an ${ALLOW_MARKER} comment with a reason.`,
    );
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
