import { test, expect, type BrowserContext, type Page, type WebSocketRoute } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';

test('two editors merge live and disconnected rich-text changes, while viewer and revoked member cannot write', async ({ browser }) => {
  test.setTimeout(120000);
  const contexts: BrowserContext[] = [];
  const runtimeErrors: string[] = [];
  const origin = 'http://127.0.0.1:4318';
  async function account(name: string) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); contexts.push(context);
    const email = 'collab-' + randomUUID() + '@example.test';
    const response = await context.request.post(origin + '/api/auth/register', { headers: { Origin: origin }, data: { name, email, password: 'Synthetic-Collaboration-Test-2026' } });
    expect(response.status()).toBe(201);
    const session = await response.json();
    return { context, email, user: session.user, headers: { Origin: origin, 'X-CSRF-Token': session.csrfToken } };
  }
  try {
    const alice = await account('小安'), bob = await account('阿晴'), viewer = await account('只讀夥伴');
    const spaceResponse = await alice.context.request.post(origin + '/api/workspaces', { headers: alice.headers, data: { name: '一起編輯旅行手帳', type: 'group' } });
    expect(spaceResponse.status()).toBe(201);
    const { workspace } = await spaceResponse.json();
    for (const [member, role] of [[bob, 'editor'], [viewer, 'viewer']] as const) {
      expect((await alice.context.request.post(origin + '/api/workspaces/' + workspace.id + '/members', { headers: alice.headers, data: { email: member.email, role } })).ok()).toBeTruthy();
    }
    const created = await alice.context.request.post(origin + '/api/workspaces/' + workspace.id + '/notes', { headers: alice.headers, data: { title: '共同手帳｜一起把旅行寫完整', content: '# 京都旅行手帳\n\n行程段落：鴨川散步。\n\n採買段落：帶一盒抹茶。', tags: ['共同編輯'], clientMutationId: randomUUID() } });
    expect(created.status()).toBe(201);
    const note = (await created.json()).note;
    let connectedB = true;
    const bobSockets: WebSocketRoute[] = [];
    await bob.context.routeWebSocket('**/api/collaboration', socket => {
      bobSockets.push(socket);
      if (connectedB) socket.connectToServer(); else void socket.close({ code: 1013, reason: 'Deliberate test network interruption' });
    });
    async function open(context: BrowserContext) {
      const page = await context.newPage(); page.on('pageerror', error => runtimeErrors.push(error.message));
      await page.goto(origin);
      await page.getByLabel('選擇工作空間').selectOption(workspace.id);
      await page.getByRole('button', { name: /共同手帳｜一起把旅行寫完整/ }).click();
      const editor = page.getByRole('textbox', { name: '筆記內容編輯器', exact: true });
      await expect(editor).toContainText('行程段落');
      return { page, editor };
    }
    const a = await open(alice.context), b = await open(bob.context), v = await open(viewer.context);
    await expect(a.editor).toHaveAttribute('contenteditable', 'true');
    await expect(b.editor).toHaveAttribute('contenteditable', 'true');
    await expect(v.editor).toHaveAttribute('contenteditable', 'false');
    async function append(page: Page, paragraph: string, addition: string) {
      await page.getByRole('textbox', { name: '筆記內容編輯器', exact: true }).locator('p').filter({ hasText: paragraph }).first().click();
      await page.keyboard.press('End'); await page.keyboard.insertText(addition);
    }
    await Promise.all([append(a.page, '行程段落', ' 小安加入寺院散步。'), append(b.page, '採買段落', ' 阿晴加入和紙筆記本。')]);
    for (const editor of [a.editor, b.editor, v.editor]) {
      await expect(editor).toContainText('小安加入寺院散步');
      await expect(editor).toContainText('阿晴加入和紙筆記本');
    }
    connectedB = false;
    await Promise.all(bobSockets.map(socket => socket.close({ code: 1013, reason: 'Deliberate test network interruption' })));
    await append(b.page, '採買段落', ' 離線補上茶杯。');
    await append(a.page, '行程段落', ' 在線補上雨天備案。');
    await expect(a.editor).not.toContainText('離線補上茶杯');
    connectedB = true;
    for (const editor of [a.editor, b.editor]) {
      await expect(editor).toContainText('離線補上茶杯', { timeout: 25000 });
      await expect(editor).toContainText('在線補上雨天備案', { timeout: 25000 });
    }
    await expect.poll(async () => (await (await alice.context.request.get(origin + '/api/notes/' + note.id)).json()).note.content).toContain('離線補上茶杯');
    mkdirSync('docs/screenshots', { recursive: true });
    await a.page.screenshot({ path: 'docs/screenshots/collaborative-editor-zh.png', fullPage: true });
    const revoke = await alice.context.request.delete(origin + '/api/workspaces/' + workspace.id + '/members/' + bob.user.id, { headers: alice.headers, data: {} });
    expect(revoke.ok()).toBeTruthy();
    await expect.poll(async () => (await b.editor.count()) === 0 || (await b.editor.getAttribute('contenteditable')) === 'false').toBe(true);
    expect([403, 404]).toContain((await bob.context.request.get(origin + '/api/notes/' + note.id)).status());
    await a.page.reload();
    await a.page.getByLabel('選擇工作空間').selectOption(workspace.id);
    await a.page.getByRole('button', { name: /共同手帳｜一起把旅行寫完整/ }).click();
    await expect(a.page.getByRole('textbox', { name: '筆記內容編輯器', exact: true })).toContainText('離線補上茶杯');
    expect(runtimeErrors).toEqual([]);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
