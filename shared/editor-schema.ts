import { decodeHtmlEntities, flattenExtensions, getSchema, type Extensions, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { MarkdownManager } from '@tiptap/markdown';

/** Bump when the document schema or accepted attribute policy changes. */
export const SCHEMA_VERSION = 1;
export const COLLAB_FIELD = 'content';
export const POSITION_MIGRATION_ROOT = `__tiptap_position_migrations:root:${COLLAB_FIELD}`;
export const NOTE_LIMITS = Object.freeze({
  markdownCharacters: 512 * 1024,
  projectionBytes: 2 * 1024 * 1024,
  stateBytes: 8 * 1024 * 1024,
  depth: 32,
  nodes: 20_000,
  sketchCharacters: 250_000,
  sketchStrokes: 2000,
  pointsPerStroke: 10_000,
  linkCharacters: 2048,
  positionMigrations: 2000,
  positionTransfers: 20_000,
  positionSeenClients: 1000,
});

/** Yjs encodes UTF-8, so incomplete UTF-16 surrogate pairs must not enter a snapshot. */
export function isWellFormedText(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

/** Link policy is shared by the toolbar, renderer and the authoritative validator. */
export function isSafeLink(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > NOTE_LIMITS.linkCharacters || value.trim() !== value || !isWellFormedText(value)) return false;
  const control = [...value].some(character => { const code = character.codePointAt(0)!; return code <= 32 || (code >= 127 && code <= 159); });
  if (control || /[\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\\]/u.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) return false;
  if (/^\/api\/files\/[0-9a-f-]{36}$/i.test(value)) return true;
  if (/^#[\p{L}\p{N}_.:-]{1,100}$/u.test(value)) return true;
  try {
    const url = new URL(value);
    if (url.protocol === 'mailto:') return /^mailto:[^@\s<>?]+@[^@\s<>?]+\.[^@\s<>?]+$/i.test(value);
    return ['https:', 'http:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}

export function createEditorExtensions(): Extensions {
  return [
    StarterKit.configure({
      undoRedo: false,
      underline: false,
      link: { openOnClick: false, markdownLinks: false, isAllowedUri: isSafeLink, HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow', class: null } },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
  ];
}

const baseExtensions = createEditorExtensions();
export const editorSchema = getSchema(baseExtensions);
const attributeEntities = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\\/g, '&#92;').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;');
// The upstream Markdown beta serializers need these lossless boundary fixes.
// Only serialization is extended; the editor/server still use the same schema.
const markdownExtensions = flattenExtensions(baseExtensions).filter(extension => extension.type !== 'extension').map(extension => {
  if (extension.type === 'node' && extension.name === 'codeBlock') return extension.extend({
    renderMarkdown(node: JSONContent) {
      const text = (node.content || []).map(child => child.text || '').join('');
      let length = 3; for (const run of text.matchAll(/`+/g)) length = Math.max(length, run[0].length + 1);
      const fence = '`'.repeat(length);
      return `${fence}${node.attrs?.language || ''}\n${text}\n${fence}`;
    },
  });
  if (extension.type === 'node' && extension.name === 'paragraph') return extension.extend({
    renderMarkdown(node: JSONContent, helpers) {
      if (!node.content?.length) return '&nbsp;';
      return helpers.renderChildren(node.content).split('\n').map(line => {
        if (/^ {4}/.test(line)) return '&#32;' + line.slice(1);
        // Escape block markers only; inline mark delimiters remain functional.
        return line.replace(/^( {0,3})(#{1,6}(?=\s|$)|[-+](?=\s|$)|-(?=[- ]{2,}$)|=(?=[= ]+$)|>)/, '$1\\$2')
          .replace(/^( {0,3}(?:\d{1,9}|[a-zA-Z]+))([.)])(?=\s)/, '$1\\$2');
      }).join('\n');
    },
  });
  if (extension.type === 'mark' && extension.name === 'link') return extension.extend({
    parseMarkdown(token, helpers) {
      return helpers.applyMark('link', helpers.parseInline(token.tokens || []), { href: decodeHtmlEntities(String(token.href || '')), title: token.title ? decodeHtmlEntities(String(token.title)) : null });
    },
    renderMarkdown(node: JSONContent, helpers) {
      const href = attributeEntities(String(node.attrs?.href || ''));
      const title = node.attrs?.title ? ` "${attributeEntities(String(node.attrs.title))}"` : '';
      return `[${helpers.renderChildren(node)}](<${href}>${title})`;
    },
  });
  return extension;
});
const markdownManager = new MarkdownManager({ extensions: markdownExtensions });

/** Serialization only: it never inserts HTML into the DOM. */
export function serializeEditorJson(json: JSONContent): string {
  return markdownManager.serialize(json);
}

/** Legacy Markdown is parsed only on the server, where raw HTML stays literal text. */
export function parseMarkdownOnServer(markdown: string): JSONContent {
  if (typeof window !== 'undefined') throw new Error('Markdown imports must be parsed by the server');
  const tokens = markdownManager.instance.lexer(markdown, markdownManager.instance.defaults);
  markdownManager.instance.walkTokens(tokens, token => {
    if (token.type === 'image' || token.type === 'table') throw new Error(`Unsupported Markdown ${token.type}; preserve the original and use attachments or literal text`);
  });
  const result = markdownManager.parse(markdown);
  if (!result.content?.length) result.content = [{ type: 'paragraph' }];
  return result;
}
