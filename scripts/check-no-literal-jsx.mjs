// Complements eslint-plugin-i18next, which misses JSX that is an arrow function's expression body.
// Fails if any JSX text node under src/ui or src/App.tsx contains letters/digits outside {t(...)}.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const roots = ['src/ui', 'src/App.tsx'];
const files = [];
const walk = (p) => {
  if (statSync(p).isDirectory()) readdirSync(p).forEach((f) => walk(join(p, f)));
  else if (p.endsWith('.tsx')) files.push(p);
};
roots.forEach(walk);

let bad = 0;
for (const file of files) {
  const src = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const visit = (n) => {
    if (ts.isJsxText(n) && /[\p{L}\p{N}]/u.test(n.text)) {
      const { line } = src.getLineAndCharacterOfPosition(n.getStart());
      console.error(`${file}:${line + 1}: literal JSX text: ${JSON.stringify(n.text.trim())}`);
      bad++;
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
}
if (bad) process.exit(1);
console.log(`no literal JSX text in ${files.length} files`);
