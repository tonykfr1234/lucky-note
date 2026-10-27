import type { JSONContent } from '@tiptap/core';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { COLLAB_FIELD, NOTE_LIMITS, POSITION_MIGRATION_ROOT, editorSchema, isSafeLink, isWellFormedText, parseMarkdownOnServer, serializeEditorJson } from '../shared/editor-schema.js';

type JsonRecord = Record<string, unknown>;
const markerPrefix = '<!--luckynote-sketch:';
const markerPattern = /^<!--luckynote-sketch:([A-Za-z0-9+/]*={0,2})-->$/;
const nodeTypes = new Set(['doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'blockquote', 'codeBlock', 'horizontalRule', 'hardBreak']);
const markTypes = new Set(['bold', 'italic', 'strike', 'code', 'link']);
function fail(reason: string): never { throw new Error(`Invalid collaborative note: ${reason}`); }
function object(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(`${label} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail(`${label} has an unsupported prototype`);
  return value as JsonRecord;
}
function keys(value: JsonRecord, allowed: readonly string[], label: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label} contains unsupported attribute ${key}`);
}
function optionalText(value: unknown, max: number, label: string) {
  if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > max || value.includes('\0') || !isWellFormedText(value))) fail(`${label} is invalid`);
}

/** Keep the baseline drawing limits, validate UTF-8/base64 strictly and preserve its exact bytes. */
export function validateSketchBase64(value: unknown): asserts value is string {
  if (typeof value !== 'string') fail('sketch must be a base64 string');
  if (value === '') return;
  if (value.length > Math.ceil(NOTE_LIMITS.sketchCharacters * 4 / 3) + 4 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail('invalid sketch base64');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) fail('noncanonical sketch base64');
  let json: string;
  try { json = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return fail('sketch is not UTF-8'); }
  if (json.length > NOTE_LIMITS.sketchCharacters) fail('sketch exceeds 250 KB');
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return fail('sketch is not JSON'); }
  if (!Array.isArray(parsed) || parsed.length > NOTE_LIMITS.sketchStrokes) fail('invalid sketch stroke count');
  for (const entry of parsed) {
    const stroke = object(entry, 'stroke'); keys(stroke, ['points', 'color', 'width'], 'stroke');
    if (typeof stroke.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(stroke.color)) fail('invalid sketch color');
    if (typeof stroke.width !== 'number' || !Number.isFinite(stroke.width) || stroke.width < 1 || stroke.width > 100) fail('invalid sketch width');
    if (!Array.isArray(stroke.points) || stroke.points.length > NOTE_LIMITS.pointsPerStroke) fail('invalid sketch point count');
    for (const entryPoint of stroke.points) {
      const point = object(entryPoint, 'point'); keys(point, ['x', 'y'], 'point');
      if (typeof point.x !== 'number' || typeof point.y !== 'number' || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) fail('invalid sketch coordinates');
    }
  }
}

export function splitLegacyContent(content: string): { markdown: string; sketchBase64: string } {
  if (typeof content !== 'string' || content.length > NOTE_LIMITS.markdownCharacters || content.includes('\0') || !isWellFormedText(content)) fail('legacy note exceeds content limits or has malformed Unicode');
  const lines = content.split('\n'); let fence = ''; let fenceLength = 0;
  const candidates: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]; const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (delimiter) {
      const run = delimiter[1];
      if (fence) { if (run[0] === fence && run.length >= fenceLength && !delimiter[2].trim()) fence = ''; }
      else if (run[0] !== '`' || !delimiter[2].includes('`')) { fence = run[0]; fenceLength = run.length; }
      continue;
    }
    // Metadata is only our reserved standalone trailing line. Marker-shaped text
    // inside code/paragraphs is ordinary content and must never be stripped.
    if (!fence && line.startsWith(markerPrefix)) candidates.push(index);
  }
  if (!candidates.length) return { markdown: content, sketchBase64: '' };
  if (candidates.length !== 1 || candidates[0] !== lines.length - 1) fail('invalid or repeated legacy sketch marker; original must be retained');
  const match = markerPattern.exec(lines[candidates[0]]);
  if (!match?.[1]) fail('malformed or empty legacy sketch marker');
  const sketchBase64 = match[1]; validateSketchBase64(sketchBase64);
  return { markdown: lines.slice(0, -1).join('\n'), sketchBase64 };
}

function validateAttributes(type: string, attrsValue: unknown, mark = false) {
  const attrs = attrsValue == null ? {} : object(attrsValue, `${type} attributes`);
  if (mark && type === 'link') {
    keys(attrs, ['href', 'target', 'rel', 'class', 'title'], 'link');
    if (!isSafeLink(attrs.href)) fail('unsafe link URL');
    if (attrs.target !== undefined && attrs.target !== null && attrs.target !== '_blank' && attrs.target !== '_self') fail('unsafe link target');
    if (attrs.class !== undefined && attrs.class !== null && attrs.class !== '') fail('custom link class is not allowed');
    if (attrs.rel !== undefined && attrs.rel !== null && (typeof attrs.rel !== 'string' || attrs.rel.length > 80 || attrs.rel.split(/\s+/).some(token => !['', 'noopener', 'noreferrer', 'nofollow'].includes(token)))) fail('unsafe link relationship');
    optionalText(attrs.title, 300, 'link title'); return;
  }
  if (type === 'heading') { keys(attrs, ['level'], type); if (attrs.level !== undefined && (typeof attrs.level !== 'number' || !Number.isInteger(attrs.level) || attrs.level < 1 || attrs.level > 6)) fail('invalid heading level'); return; }
  if (type === 'orderedList') { keys(attrs, ['start', 'type'], type); if (attrs.start !== undefined && (typeof attrs.start !== 'number' || !Number.isSafeInteger(attrs.start) || attrs.start < 1 || attrs.start > 999_999_999)) fail('invalid ordered list start'); if (attrs.type !== undefined && attrs.type !== null && attrs.type !== '1') fail('only decimal ordered lists are supported'); return; }
  if (type === 'taskItem') { keys(attrs, ['checked'], type); if (attrs.checked !== undefined && typeof attrs.checked !== 'boolean') fail('invalid task checked state'); return; }
  if (type === 'codeBlock') { keys(attrs, ['language'], type); if (attrs.language !== undefined && attrs.language !== null && (typeof attrs.language !== 'string' || !/^[\w#+.-]{0,50}$/.test(attrs.language))) fail('invalid code language'); return; }
  keys(attrs, [], type);
}

function validateJson(json: JSONContent): void {
  const stack: Array<{ value: unknown; depth: number; root: boolean }> = [{ value: json, depth: 0, root: true }];
  let nodeCount = 0; let characters = 0;
  while (stack.length) {
    const { value, depth, root } = stack.pop()!;
    if (++nodeCount > NOTE_LIMITS.nodes || depth > NOTE_LIMITS.depth) fail('document structure exceeds limits');
    const node = object(value, 'node'); keys(node, ['type', 'attrs', 'content', 'text', 'marks'], 'node');
    if (typeof node.type !== 'string' || !nodeTypes.has(node.type) || (root ? node.type !== 'doc' : node.type === 'doc')) fail('unsupported document node');
    validateAttributes(node.type, node.attrs);
    if (node.type === 'text') { if (typeof node.text !== 'string' || !node.text.length || node.text.includes('\0') || !isWellFormedText(node.text) || node.content !== undefined) fail('invalid text node'); characters += node.text.length; }
    else if (node.text !== undefined) fail('text is only allowed in a text node');
    if (characters > NOTE_LIMITS.markdownCharacters) fail('document text exceeds limits');
    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks) || node.marks.length > markTypes.size) fail('invalid marks');
      const names = new Set<string>();
      for (const valueMark of node.marks) {
        const m = object(valueMark, 'mark'); keys(m, ['type', 'attrs'], 'mark');
        if (typeof m.type !== 'string' || !markTypes.has(m.type) || names.has(m.type)) fail('unsupported or repeated mark');
        names.add(m.type); validateAttributes(m.type, m.attrs, true);
        if (m.type === 'code' && typeof node.text === 'string' && /[\r\n]/.test(node.text)) fail('inline code cannot contain line breaks; use a code block');
      }
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content) || node.content.length > NOTE_LIMITS.nodes) fail('invalid child nodes');
      for (const child of node.content) stack.push({ value: child, depth: depth + 1, root: false });
    }
  }
  // ProseMirror verifies that structural combinations match the shared schema.
  editorSchema.nodeFromJSON(json).check();
}

function inspectRawXml(fragment: Y.XmlFragment) {
  const queue: Array<{ node: unknown; depth: number }> = fragment.toArray().map(node => ({ node, depth: 1 }));
  let count = 0; let characters = 0;
  while (queue.length) {
    const { node, depth } = queue.pop()!;
    if (++count > NOTE_LIMITS.nodes || depth > NOTE_LIMITS.depth) fail('XML structure exceeds limits');
    if (node instanceof Y.XmlElement) {
      if (!nodeTypes.has(node.nodeName) || ['doc', 'text'].includes(node.nodeName)) fail('unsupported XML element');
      validateAttributes(node.nodeName, node.getAttributes());
      const children = node.toArray(); if (children.length > NOTE_LIMITS.nodes) fail('XML child limit exceeded');
      for (const child of children) queue.push({ node: child, depth: depth + 1 });
    } else if (node instanceof Y.XmlText) {
      if (Object.keys(node.getAttributes()).length) fail('XML text attributes are unsupported');
      const delta = node.toDelta();
      count += delta.length;
      for (const part of delta) { if (typeof part.insert !== 'string' || part.insert.includes('\0') || !isWellFormedText(part.insert)) fail('embedded content or malformed Unicode is not supported'); characters += part.insert.length; }
      if (count > NOTE_LIMITS.nodes || characters > NOTE_LIMITS.markdownCharacters) fail('XML text exceeds limits');
    } else fail('unexpected XML type');
  }
}

export function validateNoteDoc(doc: Y.Doc): void {
  for (const key of doc.share.keys()) if (key !== COLLAB_FIELD && key !== 'metadata' && key !== POSITION_MIGRATION_ROOT) fail('unexpected root type');
  if (!doc.share.has(COLLAB_FIELD)) fail('missing content root');
  const content = doc.getXmlFragment(COLLAB_FIELD);
  // Yjs named roots decode initially as AbstractType. Reject hidden map/list data
  // before their public root type is selected; this is verified against Yjs 13.
  if (content._map.size) fail('content root contains map data');
  inspectRawXml(content);
  if (doc.share.has('metadata')) {
    const metadata = doc.getMap('metadata');
    if (metadata._start !== null) fail('metadata root contains list data');
    for (const key of metadata.keys()) if (key !== 'sketch') fail('unexpected metadata key');
    if (metadata.has('sketch')) validateSketchBase64(metadata.get('sketch'));
  }
  if (doc.share.has(POSITION_MIGRATION_ROOT)) validatePositionMigrations(doc.getMap(POSITION_MIGRATION_ROOT));
  const json = yDocToProsemirrorJSON(doc, COLLAB_FIELD) as JSONContent;
  validateJson(json);
  if (Y.encodeStateAsUpdate(doc).byteLength > NOTE_LIMITS.stateBytes) fail('Yjs state exceeds size limit');
  const markdown = serializeEditorJson(json);
  const sketch = doc.share.has('metadata') ? (doc.getMap('metadata').get('sketch') as string | undefined) : undefined;
  const projection = markdown + (sketch ? `\n${markerPrefix}${sketch}-->` : '');
  if (projection.length > NOTE_LIMITS.markdownCharacters || Buffer.byteLength(projection, 'utf8') > NOTE_LIMITS.projectionBytes) fail('Markdown projection exceeds size limit');
}

/** Exact @tiptap/y-tiptap 3.0.10 PositionMigration wire shape, not user metadata. */
function validatePositionMigrations(store: Y.Map<unknown>) {
  if (store._start !== null || store.size > NOTE_LIMITS.positionMigrations) fail('position migration store exceeds limits');
  const natural = (value: unknown, label: string) => { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) fail(`invalid position ${label}`); };
  const identity = (value: unknown) => { const id = object(value, 'position identity'); keys(id, ['client', 'clock'], 'position identity'); natural(id.client, 'client'); natural(id.clock, 'clock'); };
  const boundary = (value: unknown) => { if (value !== undefined && value !== 'start' && value !== 'end') fail('invalid position boundary'); };
  let total = 0;
  for (const [key, value] of store) {
    const migration = object(value, 'position migration'); keys(migration, ['version', 'client', 'clock', 'seen', 'transfers'], 'position migration');
    natural(migration.client, 'client'); natural(migration.clock, 'clock');
    if (migration.version !== 1 || key !== `${migration.client}:${migration.clock}`) fail('invalid position migration identity');
    if (!Array.isArray(migration.seen) || migration.seen.length > NOTE_LIMITS.positionSeenClients) fail('invalid position state vector');
    const clients = new Set<number>();
    for (const entry of migration.seen) {
      if (!Array.isArray(entry) || entry.length !== 2) fail('invalid position state vector entry');
      natural(entry[0], 'seen client'); natural(entry[1], 'seen clock');
      if (clients.has(entry[0])) fail('duplicate position state client'); clients.add(entry[0]);
    }
    if (!Array.isArray(migration.transfers)) fail('invalid position transfers');
    total += migration.transfers.length; if (total > NOTE_LIMITS.positionTransfers) fail('position transfers exceed limits');
    for (const entry of migration.transfers) {
      const transfer = object(entry, 'position transfer'); keys(transfer, ['source', 'target'], 'position transfer');
      const source = object(transfer.source, 'position source'); keys(source, ['client', 'clock', 'length', 'boundary'], 'position source');
      natural(source.client, 'source client'); natural(source.clock, 'source clock'); natural(source.length, 'source length');
      if (!(source.length as number) || (source.clock as number) + (source.length as number) > 0xffff_ffff) fail('invalid position source range'); boundary(source.boundary);
      if (transfer.target !== null) {
        const target = object(transfer.target, 'position target'); keys(target, ['client', 'clock', 'type', 'tname', 'assoc', 'boundary'], 'position target');
        natural(target.client, 'target client'); natural(target.clock, 'target clock');
        if (target.type !== null) identity(target.type);
        if (target.tname !== undefined && target.tname !== COLLAB_FIELD) fail('invalid position target root');
        if (target.assoc !== undefined && target.assoc !== -1 && target.assoc !== 0) fail('invalid position association'); boundary(target.boundary);
      }
    }
  }
}

export function markdownToYDoc(legacyContent: string): Y.Doc {
  const { markdown, sketchBase64 } = splitLegacyContent(legacyContent);
  const json = parseMarkdownOnServer(markdown); validateJson(json);
  const doc = prosemirrorJSONToYDoc(editorSchema, json, COLLAB_FIELD);
  if (sketchBase64) doc.getMap('metadata').set('sketch', sketchBase64);
  try { validateNoteDoc(doc); return doc; } catch (error) { doc.destroy(); throw error; }
}

export function projectNoteDoc(doc: Y.Doc): string {
  validateNoteDoc(doc);
  const markdown = serializeEditorJson(yDocToProsemirrorJSON(doc, COLLAB_FIELD) as JSONContent);
  const sketch = doc.share.has('metadata') ? doc.getMap('metadata').get('sketch') as string | undefined : undefined;
  return markdown + (sketch ? `\n${markerPrefix}${sketch}-->` : '');
}
