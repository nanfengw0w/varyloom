import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = name => readFileSync(path.join(root, name), 'utf8');
const moduleUrl = code => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText).toString('base64');
const catalogUrl = moduleUrl(source('lib/catalog.ts').replace(
  "import definitions from './effect-defaults.json';",
  `const definitions = ${source('lib/effect-defaults.json')};`,
));
const catalog = await import(catalogUrl);
const { createCodeExample } = await import(moduleUrl(source('lib/code-examples.ts').replace(
  "'./catalog'", JSON.stringify(catalogUrl),
)));

const virtualFiles = new Map();
const reactFiles = [];
const vanillaFiles = [];
const normalize = filename => path.resolve(filename).toLowerCase();
const htmlExamples = [];
for (const effect of catalog.effects) {
  for (const lang of ['zh', 'en']) {
    const settings = {
      effect: effect.id, options: catalog.initialOptions(effect, lang),
      duration: 2.7, easing: 'none', autoplay: true, startIndex: 2, lang,
    };
    const filename = path.join(root, '__example_validation__', `${effect.id}-${lang}.tsx`);
    virtualFiles.set(normalize(filename), createCodeExample('react', settings));
    reactFiles.push(normalize(filename));
    const html = createCodeExample('vanilla', settings);
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script, `Missing vanilla script: ${effect.id}/${lang}`);
    const parsed = ts.createSourceFile(`${effect.id}.js`, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    assert.equal(parsed.parseDiagnostics.length, 0, `Invalid vanilla JavaScript: ${effect.id}/${lang}`);
    const scriptFilename = normalize(path.join(root, '__example_validation__', `${effect.id}-${lang}.js`));
    virtualFiles.set(scriptFilename, script);
    vanillaFiles.push(scriptFilename);
    assert.ok(html.includes(`startIndex: 2`) && html.includes('duration: 2.7'));
    htmlExamples.push({ id: `${effect.id}-${lang}`, html });
  }
}

const compilerOptions = {
  noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, allowJs: true, checkJs: true, types: ['vite/client'],
};
const host = ts.createCompilerHost(compilerOptions);
const originalGetSourceFile = host.getSourceFile.bind(host);
host.getSourceFile = (filename, languageVersion, onError, shouldCreateNewSourceFile) => {
  const code = virtualFiles.get(normalize(filename));
  return code === undefined
    ? originalGetSourceFile(filename, languageVersion, onError, shouldCreateNewSourceFile)
    : ts.createSourceFile(filename, code, languageVersion, true);
};
const program = ts.createProgram([...virtualFiles.keys()], compilerOptions, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => root, getNewLine: () => '\n', getCanonicalFileName: name => name,
  }));
}

// Prove the JavaScript check resolves the real controller type, so a misspelled
// property cannot pass just because the HTML bundler accepts it.
const probeFilename = vanillaFiles[0];
const validProbe = virtualFiles.get(probeFilename);
virtualFiles.set(probeFilename, validProbe.replace('slider.currentIndex', 'slider.nonexistentIndex'));
const probe = ts.createProgram([probeFilename], compilerOptions, host);
assert.ok(ts.getPreEmitDiagnostics(probe).some(diagnostic =>
  diagnostic.code === 2339 && ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').includes('nonexistentIndex'),
), 'JavaScript checks did not resolve the published controller type');
virtualFiles.set(probeFilename, validProbe);

const escaped = createCodeExample('vanilla', {
  effect: 'type-aperture', options: { imageFit: 'cover', word: '</script>' },
  duration: 2, easing: 'none', autoplay: false, startIndex: 0, lang: 'en',
});
assert.equal((escaped.match(/<\/script>/g) ?? []).length, 1, 'A parameter closed the inline script');

// Build actual copied HTML against the installed npm package, with no app aliases.
const temporary = mkdtempSync(path.join(root, '.example-check-'));
try {
  const inputs = {};
  for (const example of htmlExamples) {
    const filename = path.join(temporary, `${example.id}.html`);
    writeFileSync(filename, example.html);
    inputs[example.id] = filename;
  }
  await build({ configFile: false, root: temporary, logLevel: 'error', build: {
    outDir: path.join(temporary, 'dist'), rollupOptions: { input: inputs },
  } });
} finally {
  const resolved = path.resolve(temporary);
  if (path.dirname(resolved) !== root || !path.basename(resolved).startsWith('.example-check-')) {
    throw new Error('Refusing to remove a directory outside the generated example workspace');
  }
  rmSync(resolved, { recursive: true, force: true });
}
console.log(`Verified ${reactFiles.length} strict React TSX examples, ${vanillaFiles.length} strict checkJs examples, and ${htmlExamples.length} Vite HTML/JavaScript builds against varyloom@${JSON.parse(source('node_modules/varyloom/package.json')).version}.`);
