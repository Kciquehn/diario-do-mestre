import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
}

function readText(relativePath) {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    fail(`Arquivo ausente: ${relativePath}`);
    return "";
  }
  return readFileSync(absolutePath, "utf8");
}

function readJSON(relativePath) {
  const source = readText(relativePath);
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`JSON inválido em ${relativePath}: ${error.message}`);
    return null;
  }
}

function walk(directory, predicate = () => true) {
  const files = [];
  if (!existsSync(directory)) return files;
  for (const entry of readdirSync(directory)) {
    if ([".git", "dist", "node_modules"].includes(entry)) continue;
    const absolutePath = join(directory, entry);
    if (statSync(absolutePath).isDirectory()) files.push(...walk(absolutePath, predicate));
    else if (predicate(absolutePath)) files.push(absolutePath);
  }
  return files;
}

function relativePath(absolutePath) {
  return relative(root, absolutePath).replaceAll("\\", "/");
}

const manifest = readJSON("module.json");
const packageJSON = readJSON("package.json");

if (manifest) {
  for (const field of ["id", "title", "description", "version"]) {
    if (typeof manifest[field] !== "string" || !manifest[field].trim()) fail(`module.json: campo obrigatório inválido: ${field}`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id ?? "")) fail("module.json: id deve usar apenas minúsculas, números e hífens.");
  if (manifest.id && manifest.id !== root.split(/[\\/]/).at(-1)) fail(`module.json: id ${manifest.id} não corresponde ao nome da pasta do módulo.`);
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version ?? "")) fail("module.json: version deve seguir SemVer.");
  if (String(manifest.compatibility?.minimum ?? "") !== "13") fail("module.json: compatibility.minimum deve permanecer em 13.");
  if (!manifest.compatibility?.verified) fail("module.json: compatibility.verified não foi informado.");
  if ("maximum" in (manifest.compatibility ?? {})) warnings.push("module.json: compatibility.maximum bloqueia gerações futuras; mantenha apenas se houver incompatibilidade conhecida.");
  if (!Array.isArray(manifest.authors) || !manifest.authors.some((author) => author?.name)) fail("module.json: informe ao menos um autor.");

  const expectedURLs = {
    url: "https://github.com/Kciquehn/diario-do-mestre",
    manifest: "https://github.com/Kciquehn/diario-do-mestre/releases/latest/download/module.json",
    download: `https://github.com/Kciquehn/diario-do-mestre/releases/download/v${manifest.version}/diario-do-mestre.zip`,
    bugs: "https://github.com/Kciquehn/diario-do-mestre/issues"
  };
  for (const [field, expected] of Object.entries(expectedURLs)) {
    if (manifest[field] !== expected) fail(`module.json: ${field} deve ser ${expected}`);
  }

  for (const path of [...(manifest.esmodules ?? []), ...(manifest.styles ?? []), ...(manifest.languages ?? []).map((language) => language.path)]) {
    if (!existsSync(join(root, path))) fail(`module.json referencia um arquivo ausente: ${path}`);
  }
}

if (manifest && packageJSON?.version !== manifest.version) fail("package.json e module.json devem usar a mesma versão.");
if (manifest && !readText("CHANGELOG.md").includes(`## ${manifest.version} `)) fail("CHANGELOG.md não possui uma seção para a versão atual.");

const releaseWorkflow = readText(".github/workflows/release.yml");
const requiredWorkflowFragments = [
  'tags:\n      - "v*"',
  "permissions:\n  contents: write",
  "uses: actions/checkout@v7",
  "uses: actions/setup-node@v7",
  'node-version: "24"',
  "package-manager-cache: false",
  "npm run validate",
  "github.ref_name",
  "./tools/build-release.ps1",
  "GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
  "gh release create",
  '"dist/diario-do-mestre.zip"',
  '"dist/module.json"'
];
for (const fragment of requiredWorkflowFragments) {
  if (!releaseWorkflow.includes(fragment)) fail(`.github/workflows/release.yml não contém a etapa obrigatória: ${fragment}`);
}

const languageFiles = manifest?.languages?.map((language) => language.path) ?? [];
const dictionaries = new Map(languageFiles.map((path) => [path, readJSON(path)]));
if (dictionaries.size) {
  const [referencePath, referenceDictionary] = dictionaries.entries().next().value;
  const referenceKeys = new Set(Object.keys(referenceDictionary ?? {}));
  for (const [path, dictionary] of dictionaries) {
    if (!dictionary) continue;
    const keys = new Set(Object.keys(dictionary));
    for (const key of referenceKeys) if (!keys.has(key)) fail(`${path}: chave ausente em relação a ${referencePath}: ${key}`);
    for (const key of keys) if (!referenceKeys.has(key)) fail(`${path}: chave extra em relação a ${referencePath}: ${key}`);
  }

  const requiredKeys = new Set();
  const sourceFiles = walk(root, (path) => [".js", ".mjs", ".hbs"].includes(extname(path)));
  for (const path of sourceFiles) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/game\.i18n\.(?:localize|format)\(\s*["'`]([^"'`]+)["'`]/g)) {
      if (!match[1].includes("${")) requiredKeys.add(match[1]);
    }
    for (const match of source.matchAll(/\blocalize\s+"([^"]+)"/g)) requiredKeys.add(match[1]);
  }
  for (const key of requiredKeys) {
    for (const [path, dictionary] of dictionaries) if (dictionary && !(key in dictionary)) fail(`${path}: chave usada pelo código está ausente: ${key}`);
  }
}

const scriptFiles = walk(join(root, "scripts"), (path) => extname(path) === ".js");
for (const path of scriptFiles) {
  const check = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
  if (check.status !== 0) fail(`${relativePath(path)}: ${check.stderr.trim() || "erro de sintaxe"}`);

  const source = readFileSync(path, "utf8");
  for (const match of source.matchAll(/\bfrom\s+["'](\.{1,2}\/[^"']+)["']/g)) {
    const imported = resolve(dirname(path), match[1]);
    if (!existsSync(imported)) fail(`${relativePath(path)} importa um arquivo ausente: ${match[1]}`);
  }
  const forbidden = [
    [/\beval\s*\(/, "eval"],
    [/\bnew\s+Function\s*\(/, "new Function"],
    [/\.updateSource\s*\(/, "updateSource"],
    [/\._source\b/, "_source"],
    [/\bgame\.socket\b/, "game.socket"]
  ];
  for (const [pattern, label] of forbidden) if (pattern.test(source)) fail(`${relativePath(path)} usa API proibida ou insegura: ${label}`);
}

for (const path of walk(join(root, "templates"), (file) => extname(file) === ".hbs")) {
  const source = readFileSync(path, "utf8");
  const stack = [];
  for (const match of source.matchAll(/{{\s*([#/])\s*(if|unless|each|with)\b[^}]*}}/g)) {
    const [, marker, block] = match;
    if (marker === "#") stack.push(block);
    else if (stack.pop() !== block) fail(`${relativePath(path)} possui bloco Handlebars fechado fora de ordem: ${block}`);
  }
  if (stack.length) fail(`${relativePath(path)} possui blocos Handlebars não fechados: ${stack.join(", ")}`);
}

const mojibakePattern = new RegExp("[\\u00C3\\u00C2]|\\u00E2(?:\\u20AC|\\u2122|\\u0153|\\u02DC)");
for (const path of walk(root, (file) => [".js", ".mjs", ".json", ".hbs", ".css", ".md", ".yml", ".yaml"].includes(extname(file)))) {
  const source = readFileSync(path, "utf8");
  if (source.includes("\uFFFD")) fail(`${relativePath(path)} contém caractere de substituição Unicode.`);
  if (mojibakePattern.test(source)) fail(`${relativePath(path)} parece conter texto UTF-8 corrompido.`);
}

for (const sensitive of [".env", ".codex", ".openai", "secrets.json"]) {
  if (existsSync(join(root, sensitive))) fail(`Arquivo ou pasta local não deve ser publicado: ${sensitive}`);
}

for (const warning of warnings) console.warn(`AVISO: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`ERRO: ${error}`);
  console.error(`\nValidação falhou com ${errors.length} erro(s).`);
  process.exit(1);
}

console.log(`Validação concluída: ${scriptFiles.length} scripts, ${languageFiles.length} idiomas e manifesto ${manifest?.version}.`);
