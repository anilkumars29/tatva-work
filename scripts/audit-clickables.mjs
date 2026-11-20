// Lists clickable JSX elements (button, Link, a, summary, or anything with onClick /
// role=button|tab|menuitem) whose className has no hover style. Skipped: our own
// components (they style hover inside), always-disabled buttons, and elements
// marked data-hover="parent" (the hover style is on the row around them).
//   node scripts/audit-clickables.mjs components/tatva/*.tsx
import fs from 'node:fs';
import ts from 'typescript';

const CLICKABLE_TAGS = new Set(['button', 'Link', 'a', 'summary']);
let found = 0;
for (const file of process.argv.slice(2)) {
  const src = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(src);
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
      const get = (n) => attrs.find((a) => a.name.getText(src) === n);
      const role = get('role')?.initializer?.getText(src) ?? '';
      const isComponent = /^[A-Z]/.test(tag) && tag !== 'Link';
      const alwaysDisabled = !!get('disabled') && !get('disabled').initializer;
      const parentHover = get('data-hover')?.initializer?.getText(src) === '"parent"';
      const clickable = !isComponent && !alwaysDisabled && !parentHover && (CLICKABLE_TAGS.has(tag) || !!get('onClick') || /"(button|tab|menuitem)"/.test(role));
      const cls = get('className')?.initializer?.getText(src) ?? '';
      const isBackdrop = /e\.target === e\.currentTarget/.test(get('onMouseDown')?.getText(src) ?? '');
      if (clickable && !isBackdrop && !/hover:|tatva-card/.test(cls)) {
        found++;
        const { line } = src.getLineAndCharacterOfPosition(node.getStart(src));
        console.log(`${file}:${line + 1} <${tag}> ${cls.replace(/\s+/g, ' ').slice(0, 130)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
}
console.log(`\n${found} clickable element(s) without a hover style`);
