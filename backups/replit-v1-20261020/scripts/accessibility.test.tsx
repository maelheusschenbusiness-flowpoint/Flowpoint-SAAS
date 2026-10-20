import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { CardTitle } from "../client/src/components/ui/card";
import { LanguagePicker } from "../client/src/components/LanguagePicker";

// Run: npx tsx --tsconfig scripts/tsconfig.accessibility.json --test scripts/accessibility.test.tsx
test("CardTitle preserves div labels by default and styles native headings with asChild", () => {
  const label = renderToStaticMarkup(<CardTitle>Label</CardTitle>);
  assert.match(label, /^<div class="text-2xl font-semibold leading-none tracking-tight">Label<\/div>$/);

  for (const Tag of ["h2", "h3"] as const) {
    const heading = renderToStaticMarkup(
      <CardTitle asChild className="text-lg" id="topic"><Tag>Topic</Tag></CardTitle>,
    );
    assert.match(heading, new RegExp(`^<${Tag} `));
    const styledLabel = renderToStaticMarkup(<CardTitle className="text-lg" id="topic">Topic</CardTitle>);
    assert.equal(heading, styledLabel.replace("<div ", `<${Tag} `).replace("</div>", `</${Tag}>`));
    assert.match(heading, /id="topic"/);
    assert.match(heading, new RegExp(`>Topic</${Tag}>$`));
    assert.doesNotMatch(heading, /<div|asChild/);
  }
});

test("marketing card titles use heading levels appropriate to their parent sections", () => {
  const expected: Record<string, string[]> = {
    "pages/Home": ["h3", "h3", "h3", "h3", "h3", "h3"],
    "pages/Features": ["h2", "h3"],
    "pages/Pricing": ["h2"],
    "pages/Benefits": ["h3"],
    "pages/SeoAudit": ["h3", "h3"],
    "components/SeoClusterLanding": ["h3", "h3"],
  };

  for (const [page, levels] of Object.entries(expected)) {
    const file = `client/src/${page}.tsx`;
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const actual: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "CardTitle") {
        assert.ok(node.openingElement.attributes.properties.some(
          attr => ts.isJsxAttribute(attr) && attr.name.getText(source) === "asChild",
        ), `${page}: heading must be forwarded to a native element`);
        const children = node.children.filter(ts.isJsxElement);
        assert.equal(children.length, 1);
        actual.push(children[0].openingElement.tagName.getText(source));
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    assert.deepEqual(actual, levels, page);
  }
});

test("language picker exposes its collapsed state and unique controls IDs for multiple instances", () => {
  const markup = renderToStaticMarkup(<><LanguagePicker /><LanguagePicker /></>);
  assert.equal((markup.match(/aria-expanded="false"/g) || []).length, 2);
  const ids = [...markup.matchAll(/aria-controls="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
  assert.equal((markup.match(/aria-label="Changer de langue"/g) || []).length, 2);

  // Check the dynamic disclosure wiring too: SSR only renders the collapsed state.
  const source = readFileSync("client/src/components/LanguagePicker.tsx", "utf8");
  assert.match(source, /const choicesId = useId\(\)/);
  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(source, /aria-controls=\{choicesId\}/);
  assert.match(source, /\{open && \(\s*<div id=\{choicesId\}/);
  assert.match(source, /onClick=\{\(\) => setOpen\(!open\)\}/);
  assert.doesNotMatch(source, /role=["'](?:menu|menuitem|listbox|option)["']/);
});
