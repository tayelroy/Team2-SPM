import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import ts from 'typescript';

const rootArg = process.argv.indexOf('--root');
const root = rootArg >= 0 ? resolve(process.argv[rootArg + 1]) : resolve(import.meta.dirname, '../..');
const catalogue = JSON.parse(readFileSync(resolve(root, 'docs/test-acceptance-criteria.json'), 'utf8'));
const stories = new Map(catalogue.stories.map(story => [story.id, story]));
const categories = ['NORMAL', 'BOUNDARY', 'CONFLICT', 'FAILURE'];

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

function tags(text) {
  const references = [...text.matchAll(/\[(SG2-\d+):([\w,./-]+)\]/g)].flatMap(match =>
    match[2].split(/[,/]/).map(criterion => ({ story: match[1], criterion })));
  const found = categories.filter(category => text.includes(`[${category}]`));
  return { references, categories: found };
}

function runner(expression) {
  if (ts.isIdentifier(expression)) return ['test', 'it'].includes(expression.text);
  if (ts.isCallExpression(expression)) return runner(expression.expression);
  if (ts.isPropertyAccessExpression(expression)) {
    return ['each', 'only', 'skip', 'todo'].includes(expression.name.text) && runner(expression.expression);
  }
  return false;
}

function plainTitle(title) {
  return title.replace(/\[[^\]]+\]\s*/g, '').replace(/^['"`]|['"`]$/g, '').trim();
}

function compact(node, source) { return node.getText(source).replace(/\s+/g, ' ').trim(); }
function unique(values) { return [...new Set(values)]; }

const methods = [];
const errors = [];
const paths = ['server/src', 'client/src', 'e2e', '.github/scripts'].flatMap(directory =>
  files(resolve(root, directory)).filter(path => /\.(?:test|spec)\.(?:ts|tsx|mjs)$/.test(path))).sort();

for (const path of paths) {
  const file = relative(root, path).replaceAll('\\', '/');
  const text = readFileSync(path, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
    path.endsWith('tsx') ? ts.ScriptKind.TSX : path.endsWith('mjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  for (const diagnostic of source.parseDiagnostics) errors.push(`${file}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
  function visit(node) {
    if (ts.isCallExpression(node) && /\.(?:only|skip|todo)\b/.test(node.expression.getText(source))
        && (runner(node.expression) || /^(?:describe|test\.describe)\./.test(node.expression.getText(source)))) {
      errors.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: focused or unexecuted test/suite`);
    }
    if (ts.isCallExpression(node) && runner(node.expression) && node.arguments.length >= 2) {
      const title = node.arguments[0];
      const callback = node.arguments.find(argument => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument));
      if (callback && (ts.isStringLiteral(title) || ts.isTemplateExpression(title) || ts.isNoSubstitutionTemplateLiteral(title))) {
        const titleSource = title.getText(source);
        const metadata = tags(titleSource);
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        if (!metadata.categories.length || !metadata.references.length) errors.push(`${file}:${line}: missing category or story reference`);
        if (/\.(?:only|skip|todo)\b/.test(node.expression.getText(source))) errors.push(`${file}:${line}: focused or unexecuted test`);
        for (const { story, criterion } of metadata.references) {
          if (!stories.has(story)) errors.push(`${file}:${line}: unknown story ${story}`);
          else if (/^AC\d+$/.test(criterion) && !stories.get(story).acceptanceCriteria[criterion]) errors.push(`${file}:${line}: unknown ${story}:${criterion}`);
        }
        const oracles = [], inputs = [], actions = [];
        let assertionHelper = false;
        function inspect(part) {
          if (ts.isVariableDeclaration(part) && part.initializer) inputs.push(compact(part, source));
          if (ts.isCallExpression(part)) {
            const call = compact(part, source);
            const callee = compact(part.expression, source);
            if (/^(?:assert(?:[A-Z]\w*)?|expect(?:[A-Z]\w*)?|checkDenied)(?:[.(]|$)/.test(callee)) assertionHelper = true;
            if (/^assert[.(]|^expect(?:\.poll)?\(/.test(callee)
                && !ts.isCallExpression(part.parent) && !ts.isPropertyAccessExpression(part.parent)) oracles.push(call);
            else if (/^(?:render|fireEvent\.|userEvent\.|validate|create)|\.(?:click|fill|check|selectOption|press|goto|reload|post|put|patch|delete|get)\b/.test(callee)
                && !call.includes('expect(')) actions.push(call);
          }
          ts.forEachChild(part, inspect);
        }
        inspect(callback.body);
        if (!oracles.length && !assertionHelper) errors.push(`${file}:${line}: no observable assertion or assertion helper`);
        const suites = [];
        for (let parent = node.parent; parent; parent = parent.parent) {
          if (ts.isCallExpression(parent) && /^(?:describe|test\.describe)(?:\.|$)/.test(parent.expression.getText(source)) && parent.arguments[0]) {
            suites.unshift(plainTitle(parent.arguments[0].getText(source)));
          }
        }
        const id = 'TC-' + createHash('sha256').update(file + '\n' + suites.join(' > ') + '\n' + plainTitle(titleSource)).digest('hex').slice(0, 12);
        const mapped = metadata.references.filter(reference => /^AC\d+$/.test(reference.criterion));
        methods.push({ id, file, line, suites, title: ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title) ? title.text : titleSource,
          parameterized: ts.isTemplateExpression(title) || /\.each/.test(node.expression.getText(source)),
          ...metadata, acceptanceCriteria: mapped,
          supportingContracts: metadata.references.filter(reference => !/^AC\d+$/.test(reference.criterion)),
          preconditions: file.startsWith('e2e/') ? 'Fresh browser context, reset loopback memory fixture and fixed browser clock; production app build. No hosted Supabase.'
            : file.startsWith('client/') ? 'Isolated jsdom render or public exported helper; file setup resets mocks/session and controls clocks where relevant.'
              : file.startsWith('server/') ? 'Isolated exported handler/service or loopback Express API; controlled identity and storage fixtures. No hosted Supabase.'
                : 'Node test runner; local report/provider fixtures and temporary files; no provider requests.',
          testData: unique(inputs), steps: unique(actions), expectedAssertions: unique(oracles),
          originalPullRequests: unique(metadata.references.flatMap(reference => stories.get(reference.story)?.originalPullRequests ?? [])) });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

const sql = [];
for (const path of files(resolve(root, 'supabase/tests')).filter(path => path.endsWith('.sql') && !path.includes('/fixtures/')).sort()) {
  const file = relative(root, path);
  const lines = readFileSync(path, 'utf8').split('\n');
  for (let index = 0; index < lines.length; index++) {
    if (/\braise\s+exception\b/i.test(lines[index]) && !/\[(?:NORMAL|BOUNDARY|CONFLICT|FAILURE)\]/.test(lines[index])) {
      errors.push(`${file}:${index + 1}: untagged SQL assertion`);
    }
    if (!/\[(?:NORMAL|BOUNDARY|CONFLICT|FAILURE)\]/.test(lines[index])) continue;
    const metadata = tags(lines[index]);
    const contract = metadata.references.find(reference => !/^AC\d+$/.test(reference.criterion));
    if (!contract) errors.push(`${file}:${index + 1}: SQL assertion needs a unique contract`);
    for (const { story, criterion } of metadata.references) {
      if (!stories.has(story)) errors.push(`${file}:${index + 1}: unknown story ${story}`);
      else if (/^AC\d+$/.test(criterion) && !stories.get(story).acceptanceCriteria[criterion]) errors.push(`${file}:${index + 1}: unknown ${story}:${criterion}`);
    }
    const nextTag = lines.findIndex((line, position) => position > index && /\[(?:NORMAL|BOUNDARY|CONFLICT|FAILURE)\]/.test(line));
    const before = lines.slice(0, index).join('\n');
    const conditions = [...before.matchAll(/^\s*if\s+([\s\S]*?)\s+then\s*$/gm)];
    const condition = conditions.at(-1);
    const begin = [...before.matchAll(/^\s*begin\s*$/gm)].at(-1);
    const after = lines.slice(index + 1, nextTag < 0 ? lines.length : nextTag).join('\n');
    const handler = after.match(/exception\s+when\s+([\w_]+)\s+then/);
    const statement = handler ? `Reject with ${handler[1]}: ${before.slice((begin?.index ?? 0) + (begin?.[0].length ?? 0)).trim()}`
      : condition && (!begin || condition.index > begin.index)
        ? `Must be false: ${condition[1].replace(/\s+/g, ' ').trim()}`
        : 'See the tagged assertion and its surrounding SQL block for the exact expected result.';
    sql.push({ id: contract ? `${contract.story}:${contract.criterion}` : `${file}:${index+1}`, file, line: index + 1,
      title: lines[index].replace(/^\s*--\s*/, '').trim(), ...metadata,
      acceptanceCriteria: metadata.references.filter(reference => /^AC\d+$/.test(reference.criterion)),
      preconditions: 'Disposable PostgreSQL, auth fixture and committed migrations; transaction-local synthetic records and role changes; suite rolls back.',
      expectedAssertions: [statement],
      originalPullRequests: unique(metadata.references.flatMap(reference => stories.get(reference.story)?.originalPullRequests ?? [])) });
  }
}

if (new Set(methods.map(method => method.id)).size !== methods.length) {
  for (const method of methods.filter((method, index) => methods.findIndex(other => other.id === method.id) !== index)) errors.push(`Duplicate method ID: ${method.file}:${method.line} ${method.title}`);
}
if (new Set(sql.map(method => method.id)).size !== sql.length) errors.push('Duplicate SQL contract IDs.');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

const inventory = { schemaVersion: 1, reviewDate: catalogue.reviewDate,
  scope: 'Every current leaf test declaration and tagged SQL assertion. Parameterized declarations can execute several runner cases; this is a method inventory, not a count of acceptance workflows.',
  methods, sqlAssertions: sql };
// The committed ledger maps methods to requirements. Detailed source oracles
// are exported separately for the course workbook, avoiding a second copy of
// every fixture and assertion in the pull-request diff.
const detailsIndex = process.argv.indexOf('--details');
if (detailsIndex >= 0) {
  const target = process.argv[detailsIndex + 1];
  if (!target) throw new Error('--details needs an output path');
  writeFileSync(target, JSON.stringify(inventory, null, 2) + '\n');
}
const ledgerMethods = methods.map(({ id, file, line, suites, title, parameterized, categories, references }) =>
  ({ id, file, line, suites, title, parameterized, categories, references }));
const ledgerSql = sql.map(({ id, file, line, title, categories, references }) => ({ id, file, line, title, categories, references }));
const output = '{\n' + `  "schemaVersion": 1,\n  "reviewDate": ${JSON.stringify(catalogue.reviewDate)},\n  "scope": ${JSON.stringify(inventory.scope)},\n`
  + '  "methods": [\n' + ledgerMethods.map(method => '    ' + JSON.stringify(method)).join(',\n') + '\n  ],\n'
  + '  "sqlAssertions": [\n' + ledgerSql.map(method => '    ' + JSON.stringify(method)).join(',\n') + '\n  ]\n}\n';
const destination = resolve(root, 'docs/test-case-inventory.json');
if (process.argv.includes('--write')) writeFileSync(destination, output);
else if (readFileSync(destination, 'utf8') !== output) {
  console.error('Test inventory is stale. Run npm run test:inventory:update and review the changed AC/category mappings.');
  process.exit(1);
}
console.log(`Test inventory verified: ${paths.length} executable test files, ${methods.length} methods, ${sql.length} SQL assertions.`);
