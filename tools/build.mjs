// Build: TypeScript emits dist/*.js and *.d.ts from src/; the stylesheet and
// the Astro wrapper are copied as they are. Prints each file's size, gzipped.
//
// In the emitted JavaScript the private members of the classes (the player
// has about two hundred) get short names: a bundler can shorten a variable
// but never a property, so `this.placeAtResize` would otherwise reach every
// site in full. Which names are private is not guessed from how they are
// spelled: the type checker says, for each use, which declaration it is.
// Only a use that resolves to a `private` class member is renamed, so a
// public member, an attribute, an event, a DOM property or another object's
// property of the same name is never touched. The .d.ts files keep the
// source names. The browser tests run on src/; the built files are proven
// by test/package.test.mjs and by the examples run with --packed.
import ts from 'typescript';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

// Interfaces that mirror a class's private members so another file can read
// them (flythrough/debug reads the player): renamed with the class, and
// every member must be one of that class's private members.
const MIRRORS = [{ file: 'src/debug.ts', name: 'Inner', of: 'Flythrough' }];

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

rmSync('dist', { recursive: true, force: true });
const config = ts.getParsedCommandLineOfConfigFile('tsconfig.build.json', {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => fail(ts.flattenDiagnosticMessageText(d.messageText, '\n')) });
const program = ts.createProgram(config.fileNames, config.options);
const problems = ts.getPreEmitDiagnostics(program);
if (problems.length) fail(ts.formatDiagnosticsWithColorAndContext(problems, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' }));
const checker = program.getTypeChecker();
const sources = program.getSourceFiles().filter((f) => !f.isDeclarationFile && !program.isSourceFileFromExternalLibrary(f));

// ---- which members are private
// One entry per private member; a getter and a setter of one name share it.
const byDeclaration = new Map();
const byClass = new Map(); // class name -> Map(member name -> entry)
const isPrivate = (member) => (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Private) !== 0;
const each = (node, fn) => {
  fn(node);
  ts.forEachChild(node, (child) => each(child, fn));
};
for (const file of sources) {
  each(file, (node) => {
    if (!ts.isClassLike(node)) return;
    const members = new Map();
    if (node.name) byClass.set(node.name.text, members);
    for (const member of node.members) {
      if (!isPrivate(member) || !member.name) continue;
      if (!ts.isIdentifier(member.name)) fail(`build: a private member with a computed or quoted name in ${file.fileName}`);
      const entry = members.get(member.name.text) ?? { name: member.name.text, uses: [], kept: '' };
      members.set(entry.name, entry);
      byDeclaration.set(member, entry);
    }
  });
}
for (const mirror of MIRRORS) {
  const file = sources.find((f) => f.fileName.endsWith(mirror.file));
  const members = byClass.get(mirror.of);
  let found = false;
  if (file && members) {
    each(file, (node) => {
      if (!ts.isInterfaceDeclaration(node) || node.name.text !== mirror.name) return;
      found = true;
      for (const member of node.members) {
        const entry = member.name && ts.isIdentifier(member.name) ? members.get(member.name.text) : undefined;
        if (!entry) fail(`build: ${mirror.file}, ${mirror.name}.${member.name?.getText()} is not a private member of ${mirror.of}`);
        byDeclaration.set(member, entry);
      }
    });
  }
  if (!found) fail(`build: no interface ${mirror.name} in ${mirror.file} mirroring ${mirror.of}`);
}
const entries = [...new Set(byDeclaration.values())];
const privateNames = new Map(); // name -> its entries (one per class)
for (const entry of entries) privateNames.set(entry.name, [...(privateNames.get(entry.name) ?? []), entry]);
const keepName = (name, why) => privateNames.get(name)?.forEach((entry) => (entry.kept ||= why));

// ---- every use of them, and every other property name in the program
const otherNames = new Set();
const entryOf = (node) => {
  const symbol = checker.getSymbolAtLocation(node);
  for (const declaration of symbol?.declarations ?? []) if (byDeclaration.has(declaration)) return byDeclaration.get(declaration);
  return symbol ? null : undefined;
};
for (const file of sources) {
  each(file, (node) => {
    // A private member read by its name in a string, or pulled out of an
    // object by its name: not renamed, so the name is kept everywhere.
    if (ts.isStringLiteralLike(node) && privateNames.has(node.text)) {
      const parent = node.parent;
      const asKey = (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) || (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.InKeyword && parent.left === node);
      if (asKey) keepName(node.text, 'read by its name in a string');
      return;
    }
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name;
      if (ts.isIdentifier(key) && privateNames.has(key.text)) keepName(key.text, 'taken out of an object by its name');
    }
    if (!ts.isIdentifier(node)) return;
    const parent = node.parent;
    const named = 'name' in parent && parent.name === node;
    const asProperty = named && (ts.isPropertyAccessExpression(parent) || ts.isClassElement(parent) || ts.isTypeElement(parent) || ts.isPropertyAssignment(parent) || ts.isShorthandPropertyAssignment(parent) || ts.isMethodDeclaration(parent));
    const entry = entryOf(node);
    if (entry) {
      if (asProperty && !ts.isShorthandPropertyAssignment(parent)) entry.uses.push(node);
      else entry.kept ||= 'used in a way the build does not rename';
      return;
    }
    if (!asProperty) return;
    otherNames.add(node.text);
    // The checker could not say what this is (an `any`): it may be one of them.
    if (entry === undefined && ts.isPropertyAccessExpression(parent)) keepName(node.text, 'read through an untyped value');
  });
}

// ---- their short names: a letter and a digit. No property
// the DOM gives an element is spelled that way, and none that is used for
// anything else in src/ is taken.
const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const short = [...[...letters].flatMap((l) => [...'0123456789'].map((d) => l + d))].filter((n) => !otherNames.has(n) && !privateNames.has(n));
const renamed = entries.filter((entry) => !entry.kept).sort((a, b) => b.uses.length - a.uses.length);
if (renamed.length > short.length) fail('build: more private members than short names');
const newName = new Map();
renamed.forEach((entry, i) => entry.uses.forEach((node) => newName.set(node, short[i])));

const shorten = (context) => (file) => {
  const visit = (node) => (ts.isIdentifier(node) && newName.has(node) ? context.factory.createIdentifier(newName.get(node)) : ts.visitEachChild(node, visit, context));
  return ts.visitNode(file, visit);
};
const emitted = program.emit(undefined, undefined, undefined, false, { before: [shorten] });
if (emitted.emitSkipped) fail('build: nothing was written');

cpSync('src/flythrough.css', 'dist/flythrough.css');
mkdirSync('dist/astro', { recursive: true });
cpSync('src/astro/FlythroughPlayer.astro', 'dist/astro/FlythroughPlayer.astro');

const kept = entries.filter((entry) => entry.kept);
console.log(`${renamed.length} private members shortened${kept.length ? `; kept: ${kept.map((entry) => `${entry.name} (${entry.kept})`).join(', ')}` : ''}`);
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
for (const f of walk('dist').filter((f) => !f.endsWith('.d.ts'))) {
  const buf = readFileSync(f);
  console.log(`${f.split(path.sep).join('/').padEnd(32)} ${(buf.length / 1024).toFixed(1).padStart(6)} kB  ${(gzipSync(buf).length / 1024).toFixed(1).padStart(5)} kB gzip`);
}
