import type { JSONContent } from '@tiptap/core';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { COLLAB_FIELD, editorSchema, serializeEditorJson } from '../shared/editor-schema';
import { getLocalNote, readLocalDocument, storeLocalDocument, initializeLocalDocument } from './local-api';

export interface LocalDocumentHandle {
  doc: Y.Doc;
  save: () => Promise<void>;
  destroy: () => Promise<void>;
}
const encoder = new TextEncoder();
function text(value: string): JSONContent[] { return value ? [{ type: 'text', text: value }] : []; }
function paragraph(value: string): JSONContent { return { type: 'paragraph', content: text(value) }; }

/**
 * Local template/import bootstrap never invokes a browser HTML parser.
 * Recognized block Markdown becomes editable structure; unsupported inline
 * syntax stays literal text. Normal rich-text reload uses the saved Yjs state.
 */
function localBlocks(markdown: string): JSONContent {
  const content: JSONContent[] = [];
  let list: JSONContent | null = null;
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fence = /^(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      list = null; const block: string[] = [];
      while (++index < lines.length && !lines[index].startsWith(fence[1])) block.push(lines[index]);
      content.push({ type: 'codeBlock', attrs: { language: null }, content: text(block.join('\n')) }); continue;
    }
    const heading = /^(#{1,6}) (.*)$/.exec(line);
    if (heading) { list = null; content.push({ type: 'heading', attrs: { level: heading[1].length }, content: text(heading[2]) }); continue; }
    const task = /^- \[([ xX])\] (.*)$/.exec(line);
    if (task) {
      if (list?.type !== 'taskList') { list = { type: 'taskList', content: [] }; content.push(list); }
      list.content!.push({ type: 'taskItem', attrs: { checked: task[1].toLowerCase() === 'x' }, content: [paragraph(task[2])] }); continue;
    }
    const bullet = /^[-*+] (.*)$/.exec(line);
    if (bullet) {
      if (list?.type !== 'bulletList') { list = { type: 'bulletList', content: [] }; content.push(list); }
      list.content!.push({ type: 'listItem', content: [paragraph(bullet[1])] }); continue;
    }
    list = null;
    if (line.trim()) content.push(paragraph(line));
  }
  return { type: 'doc', content: content.length ? content : [paragraph('')] };
}
function project(doc: Y.Doc) {
  const markdown = serializeEditorJson(yDocToProsemirrorJSON(doc, COLLAB_FIELD));
  const sketch = doc.getMap('metadata').get('sketch');
  return markdown + (typeof sketch === 'string' && sketch ? '\n<!--luckynote-sketch:' + sketch + '-->' : '');
}

export async function loadLocalDocument(noteId: string, attempt = 0): Promise<LocalDocumentHandle> {
  const note = await getLocalNote(noteId);
  const saved = await readLocalDocument(noteId);
  let doc: Y.Doc;
  if (saved) {
    if (saved.byteLength > 8 * 1024 * 1024) throw new Error('Local document exceeds the storage limit.');
    doc = new Y.Doc(); doc.getXmlFragment(COLLAB_FIELD); doc.getMap('metadata'); Y.applyUpdate(doc, saved);
  } else {
    const marker = /<!--luckynote-sketch:([A-Za-z0-9+/]*={0,2})-->/.exec(note.content);
    const body = marker ? note.content.replace(marker[0], '') : note.content;
    doc = prosemirrorJSONToYDoc(editorSchema, localBlocks(body), COLLAB_FIELD);
    if (marker) doc.getMap('metadata').set('sketch', marker[1]);
    let winner: Uint8Array;
    try { winner = await initializeLocalDocument(noteId, Y.encodeStateAsUpdate(doc), project(doc), note.version); }
    catch (error) {
      doc.destroy();
      if ((error as { status?: number }).status === 409 && attempt < 2) return loadLocalDocument(noteId, attempt + 1);
      throw error;
    }
    doc.destroy();
    doc = new Y.Doc(); doc.getXmlFragment(COLLAB_FIELD); doc.getMap('metadata'); Y.applyUpdate(doc, winner);
  }
  let queue: Promise<void> = Promise.resolve();
  let closed = false;
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('luckynote-local-document-' + noteId);
  channel?.addEventListener('message', event => {
    if (!closed && event.data instanceof Uint8Array && event.data.byteLength <= 8 * 1024 * 1024) Y.applyUpdate(doc, event.data, 'local-peer');
  });
  const save = () => {
    if (closed) return Promise.reject(new Error('Local document was closed.'));
    const operation = queue.catch(() => undefined).then(async () => {
      const previous = await readLocalDocument(noteId);
      if (previous) Y.applyUpdate(doc, previous, 'local-storage');
      const state = Y.encodeStateAsUpdate(doc);
      const markdown = project(doc);
      if (state.byteLength > 8 * 1024 * 1024 || encoder.encode(markdown).length > 2 * 1024 * 1024 || markdown.length > 512 * 1024) throw new Error('Local document exceeds the storage limit.');
      await storeLocalDocument(noteId, state, markdown);
      channel?.postMessage(state);
    });
    queue = operation;
    return operation;
  };
  // Initial templates are persisted before the editor reports device storage ready.
  await save();
  return {
    doc, save,
    destroy: async () => { closed = true; channel?.close(); await queue.catch(() => undefined); doc.destroy(); },
  };
}
