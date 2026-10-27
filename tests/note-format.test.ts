import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as Y from 'yjs';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import type { JSONContent } from '@tiptap/core';
import { COLLAB_FIELD, NOTE_LIMITS, POSITION_MIGRATION_ROOT, editorSchema, isSafeLink, serializeEditorJson } from '../shared/editor-schema.js';
import { markdownToYDoc, projectNoteDoc, splitLegacyContent, validateNoteDoc, validateSketchBase64 } from '../server/note-format.js';

/** Read production template literals without evaluating or duplicating the template source. */
function actualTemplates() {
  const source = ts.createSourceFile('templates.ts', readFileSync('src/templates.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const result: Array<{ id: string; zhBody: string; enBody: string }> = [];
  function visit(node: ts.Node) {
    if (ts.isObjectLiteralExpression(node)) {
      const values: Record<string, string> = {};
      for (const p of node.properties) {
        if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && ts.isStringLiteral(p.initializer)) values[p.name.text] = p.initializer.text;
      }
      if (values.id && values.zhBody !== undefined && values.enBody !== undefined) result.push({ id: values.id, zhBody: values.zhBody, enBody: values.enBody });
    }
    ts.forEachChild(node, visit);
  }
  visit(source); return result;
}
function json(doc: Y.Doc) { return yDocToProsemirrorJSON(doc, COLLAB_FIELD) as JSONContent; }
function texts(value: JSONContent): string { return [value.text || '', ...(value.content || []).map(texts)].join(' '); }
function firstText(doc: Y.Doc): Y.XmlText { const p = doc.getXmlFragment(COLLAB_FIELD).get(0) as Y.XmlElement; return p.get(0) as Y.XmlText; }
const drawing = JSON.stringify([{ color: '#243f36', width: 3, points: [{ x: 0, y: 1 }, { x: 0.5, y: 0.5 }] }]);
const sketch = Buffer.from(drawing).toString('base64');
const templates = actualTemplates();

test('all 12 production content templates plus blank are covered in both languages', () => {
  assert.equal(templates.length, 13); assert.equal(templates.filter(template => template.id !== 'blank').length, 12);
});
for (const template of templates) for (const language of ['zhBody', 'enBody'] as const) {
  test(`Markdown/Yjs round-trip preserves ${template.id} ${language}`, t => {
    const original = template[language]; const doc = markdownToYDoc(original); t.after(() => doc.destroy());
    const projected = projectNoteDoc(doc); const reimported = markdownToYDoc(projected); t.after(() => reimported.destroy());
    assert.equal(projectNoteDoc(reimported), projected, 'export should be stable after reimport');
    assert.deepEqual(json(reimported), json(doc), 'canonical structured content must survive export');
    const visible = texts(json(doc)).replace(/\s+/g, ' ');
    for (const line of original.split('\n')) {
      const expected = line.replace(/^#{1,6}\s+/, '').replace(/^- \[[ x]\]\s*/, '').replace(/^-\s+/, '').trim();
      if (expected) assert.ok(visible.includes(expected), `lost template text: ${expected}`);
    }
    const binary = Y.encodeStateAsUpdate(doc); const loaded = new Y.Doc(); t.after(() => loaded.destroy()); Y.applyUpdate(loaded, binary); validateNoteDoc(loaded);
    assert.equal(projectNoteDoc(loaded), projected, 'binary restart retains same content');
  });
}

test('Unicode, nested tasks, code, links and inline formatting remain structured', t => {
  const source = '# 台灣 🧳\n\n**重要** *italic* ~~done~~ `程式 <tag>`\n\n- [x] 完成\n  - [ ] 子項目\n\n> 引用中文\n\n```ts\nconst a = "<script>";\n```\n\n[官方](https://example.com/路徑?q=中文)';
  const doc = markdownToYDoc(source); t.after(() => doc.destroy()); const output = projectNoteDoc(doc);
  assert.ok(output.includes('台灣 🧳')); assert.ok(output.includes('const a = "<script>";')); assert.ok(output.includes('- [x] 完成'));
  const again = markdownToYDoc(output); t.after(() => again.destroy()); assert.deepEqual(json(again), json(doc));
  assert.equal(serializeEditorJson(json(doc)), output);
});

test('malformed UTF-16 is rejected before UTF-8 encoding can silently replace it', t => {
  for (const broken of [String.fromCharCode(0xd800), String.fromCharCode(0xdc00), `a${String.fromCharCode(0xd800)}z`]) assert.throws(() => markdownToYDoc(broken), /malformed Unicode/);
  const doc = markdownToYDoc('完整 🧳'); t.after(() => doc.destroy()); firstText(doc).insert(0, String.fromCharCode(0xd800)); assert.throws(() => validateNoteDoc(doc), /malformed Unicode/);
});

test('arbitrary HTML is preserved as literal text without HTML nodes or active attributes', t => {
  const source = '<script>alert("x")</script>\n\n<img src=x onerror=alert(1)>\n\n<a href="javascript:alert(1)">click</a>\n\n普通 <em>文字</em>\n\n<!-- ordinary comment -->';
  const doc = markdownToYDoc(source); t.after(() => doc.destroy()); const document = json(doc); const visible = texts(document);
  for (const original of ['<script>alert("x")</script>', '<img src=x onerror=alert(1)>', '<a href="javascript:alert(1)">click</a>', '<em>文字</em>', '<!-- ordinary comment -->']) assert.ok(visible.includes(original), original);
  assert.ok(!JSON.stringify(document).includes('"type":"link"'));
  const again = markdownToYDoc(projectNoteDoc(doc)); t.after(() => again.destroy()); assert.deepEqual(json(again), document);
});

test('handwritten metadata survives migration, binary persistence and Markdown projection byte-for-byte', t => {
  const content = `# 手寫\n\n你好\n<!--luckynote-sketch:${sketch}-->`;
  const split = splitLegacyContent(content); assert.equal(split.sketchBase64, sketch); assert.equal(split.markdown, '# 手寫\n\n你好');
  const doc = markdownToYDoc(content); t.after(() => doc.destroy()); assert.equal(doc.getMap('metadata').get('sketch'), sketch);
  const loaded = new Y.Doc(); t.after(() => loaded.destroy()); Y.applyUpdate(loaded, Y.encodeStateAsUpdate(doc));
  const exported = projectNoteDoc(loaded); assert.ok(exported.endsWith(`<!--luckynote-sketch:${sketch}-->`)); assert.equal(Buffer.from(splitLegacyContent(exported).sketchBase64, 'base64').toString('utf8'), drawing);
});

test('invalid, duplicated or malformed handwritten markers fail instead of losing original data', () => {
  for (const value of ['text\n<!--luckynote-sketch:bad!-->', '<!--luckynote-sketch:%%%%-->', `<!--luckynote-sketch:${sketch}-->\n<!--luckynote-sketch:${sketch}-->`, '<!--luckynote-sketch:e30=-->', '<!--luckynote-sketch:/w==-->']) assert.throws(() => markdownToYDoc(value), /Invalid collaborative note/);
  const source = '<!--luckynote-sketch:broken'; assert.throws(() => splitLegacyContent(source)); assert.equal(source, '<!--luckynote-sketch:broken');
});

test('marker-like literals in inline code and fenced code cannot become sketch metadata', t => {
  for (const source of ['`Keep <!--luckynote-sketch:W10=--> literal`', '```\n<!--luckynote-sketch:W10=-->\n```', 'text<!--luckynote-sketch:bad!-->']) {
    const doc = markdownToYDoc(source); const again = markdownToYDoc(projectNoteDoc(doc));
    t.after(() => { doc.destroy(); again.destroy(); });
    assert.deepEqual(json(again), json(doc)); assert.equal(again.getMap('metadata').get('sketch'), undefined);
  }
});

test('code fences, link destinations and link titles preserve their full text on reimport', t => {
  const documents: JSONContent[] = [
    { type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'before\n```\n# literal\n````\nafter' }] }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'LINK', marks: [{ type: 'link', attrs: { href: 'https://example.com/a)bad?x=<y>&q=z', title: 'x")\n\n# Heading\n\n[other](https://example.com "y\\z' } }] }] }] },
  ];
  for (const document of documents) {
    const doc = prosemirrorJSONToYDoc(editorSchema, document, COLLAB_FIELD); t.after(() => doc.destroy()); validateNoteDoc(doc);
    const again = markdownToYDoc(projectNoteDoc(doc)); t.after(() => again.destroy()); assert.deepEqual(json(again), json(doc));
  }
});

test('literal paragraph block markers cannot turn into headings, rules or lists', t => {
  for (const text of ['# heading', '- x', '---', '+ item', '===', '3. third', 'c. third', 'I) item', '    leading spaces']) {
    const doc = prosemirrorJSONToYDoc(editorSchema, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, COLLAB_FIELD); t.after(() => doc.destroy());
    const again = markdownToYDoc(projectNoteDoc(doc)); t.after(() => again.destroy()); assert.deepEqual(json(again), json(doc), text);
  }
});

test('unsupported images, tables and ambiguous alpha lists fail rather than losing data', t => {
  for (const source of ['Inline ![photo](https://example.com/x.png) after', '![photo](https://example.com/x.png)', '| a | b |\n| --- | --- |\n| c | d |']) assert.throws(() => markdownToYDoc(source), /Unsupported Markdown/);
  const doc = markdownToYDoc('3. third'); t.after(() => doc.destroy()); (doc.getXmlFragment(COLLAB_FIELD).get(0) as Y.XmlElement).setAttribute('type', 'a'); assert.throws(() => validateNoteDoc(doc), /decimal/);
});

test('only the pinned Tiptap position migration root and record shape are accepted', t => {
  const valid = { version: 1, client: 42, clock: 5, seen: [[42, 5]], transfers: [{ source: { client: 1, clock: 2, length: 1 }, target: { client: 42, clock: 3, type: null, tname: COLLAB_FIELD, assoc: 0 } }] };
  const doc = markdownToYDoc('editor'); t.after(() => doc.destroy()); doc.getMap(POSITION_MIGRATION_ROOT).set('42:5', valid); assert.doesNotThrow(() => validateNoteDoc(doc));
  const loaded = new Y.Doc(); t.after(() => loaded.destroy()); Y.applyUpdate(loaded, Y.encodeStateAsUpdate(doc)); assert.doesNotThrow(() => validateNoteDoc(loaded)); assert.equal(projectNoteDoc(loaded), 'editor');
  for (const value of [{ ...valid, onclick: 'bad' }, { ...valid, version: 2 }, { ...valid, seen: [[42, -1]] }, { ...valid, transfers: [{ source: { client: 1, clock: 2, length: 1 }, target: { client: 42, clock: 3, type: null, tname: 'secret' } }] }]) {
    doc.getMap(POSITION_MIGRATION_ROOT).set('42:5', value); assert.throws(() => validateNoteDoc(doc));
  }
  const extra = markdownToYDoc('x'); t.after(() => extra.destroy()); firstText(extra).setAttribute('onclick', 'alert(1)'); assert.throws(() => validateNoteDoc(extra), /XML text attributes/);
});

test('link allowlist rejects script, data, obfuscated protocols and credential URLs', () => {
  for (const safe of ['https://example.com/路徑', 'http://localhost:4317', 'mailto:test@example.com', '#段落', '/api/files/12345678-1234-1234-1234-123456789012']) assert.equal(isSafeLink(safe), true, safe);
  for (const unsafe of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,test', 'vbscript:evil', '//evil.invalid', 'https://name:secret@example.com', ' https://example.com', 'java\nscript:alert(1)', 'https:\\example.com', 'https://example.com/%0a', 'mailto:test@example.com?bcc=other@example.com', '', null]) assert.equal(isSafeLink(unsafe), false, String(unsafe));
  assert.throws(() => markdownToYDoc('[unsafe](javascript:alert%281%29)'), /unsafe link/);
});

test('client-crafted Yjs unsafe marks and node attributes are rejected before projection', t => {
  for (const attributes of [{ link: { href: 'javascript:alert(1)' } }, { link: { href: 'https://safe.invalid', onclick: 'evil()' } }, { bold: { onclick: 'evil()' } }, { nonexistent: {} }]) {
    const doc = markdownToYDoc('abc'); t.after(() => doc.destroy()); firstText(doc).format(0, 1, attributes); assert.throws(() => validateNoteDoc(doc));
  }
  const doc = markdownToYDoc('abc'); t.after(() => doc.destroy()); (doc.getXmlFragment(COLLAB_FIELD).get(0) as Y.XmlElement).setAttribute('style', 'position:fixed'); assert.throws(() => validateNoteDoc(doc), /unsupported attribute/);
});

test('unknown Yjs roots, hidden root types, unsupported XML and embeds are rejected', t => {
  const extra = markdownToYDoc('x'); t.after(() => extra.destroy()); extra.getMap('secret').set('key', 'no'); assert.throws(() => validateNoteDoc(extra), /unexpected root/);
  const mapRoot = new Y.Doc(); t.after(() => mapRoot.destroy()); mapRoot.getMap('content').set('hidden', 'data'); const decoded = new Y.Doc(); t.after(() => decoded.destroy()); Y.applyUpdate(decoded, Y.encodeStateAsUpdate(mapRoot)); assert.throws(() => validateNoteDoc(decoded), /map data/);
  const xml = markdownToYDoc('x'); t.after(() => xml.destroy()); xml.getXmlFragment(COLLAB_FIELD).insert(0, [new Y.XmlElement('iframe')]); assert.throws(() => validateNoteDoc(xml), /unsupported XML/);
  const embed = markdownToYDoc('x'); t.after(() => embed.destroy()); firstText(embed).insertEmbed(0, { html: '<img>' }); assert.throws(() => validateNoteDoc(embed), /embedded/);
  const metadata = markdownToYDoc('x'); t.after(() => metadata.destroy()); metadata.getMap('metadata').set('admin', true); assert.throws(() => validateNoteDoc(metadata), /unexpected metadata/);
});

test('malicious nesting is refused before recursive conversion and oversized documents are not truncated', t => {
  const doc = new Y.Doc(); t.after(() => doc.destroy()); const root = new Y.XmlElement('blockquote'); let current = root;
  for (let index = 0; index < NOTE_LIMITS.depth + 2; index++) { const child = new Y.XmlElement('blockquote'); current.insert(0, [child]); current = child; }
  doc.getXmlFragment(COLLAB_FIELD).insert(0, [root]); assert.throws(() => validateNoteDoc(doc), /structure exceeds limits/);
  assert.throws(() => markdownToYDoc('a'.repeat(NOTE_LIMITS.markdownCharacters + 1)), /content limits/);
  const large = markdownToYDoc('x'); t.after(() => large.destroy()); firstText(large).insert(1, 'a'.repeat(NOTE_LIMITS.markdownCharacters)); assert.throws(() => validateNoteDoc(large), /text exceeds limits/); assert.equal(firstText(large).length, NOTE_LIMITS.markdownCharacters + 1);
});

test('sketch validation enforces existing stroke/point/color bounds and rejects nested payloads', () => {
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64');
  for (const bad of [{}, [{ color: 'url(evil)', width: 3, points: [] }], [{ color: '#000000', width: 101, points: [] }], [{ color: '#000000', width: 3, points: [{ x: -1, y: 0 }] }], [{ color: '#000000', width: 3, points: [], onclick: 'evil' }], Array.from({ length: 2001 }, () => ({ color: '#000000', width: 3, points: [] }))]) assert.throws(() => validateSketchBase64(encoded(bad)));
  assert.doesNotThrow(() => validateSketchBase64(sketch));
});

test('Yjs binary histories merge concurrent offline edits and duplicate updates without duplicating the seed', t => {
  const original = markdownToYDoc('基礎'); const a = new Y.Doc(); const b = new Y.Doc(); const fresh = new Y.Doc();
  for (const doc of [original, a, b, fresh]) t.after(() => doc.destroy());
  const seed = Y.encodeStateAsUpdate(original); Y.applyUpdate(a, seed); Y.applyUpdate(b, seed);
  firstText(a).insert(0, '甲'); firstText(b).insert(firstText(b).length, '乙');
  const updateA = Y.encodeStateAsUpdate(a); const updateB = Y.encodeStateAsUpdate(b);
  Y.applyUpdate(a, updateB); Y.applyUpdate(b, updateA); Y.applyUpdate(a, updateB);
  assert.equal(projectNoteDoc(a), projectNoteDoc(b)); assert.equal(projectNoteDoc(a), '甲基礎乙');
  Y.applyUpdate(fresh, Y.encodeStateAsUpdate(a)); assert.equal(projectNoteDoc(fresh), '甲基礎乙');
});
