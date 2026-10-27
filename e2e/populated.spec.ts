import { test, expect, devices, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

test.use({ locale: 'en-US' });
async function syncedEditor(page: Page) {
  const editor = page.getByLabel('筆記內容編輯器', { exact: true });
  await expect(editor).toBeVisible();
  await expect(page.locator('.collaboration-status')).toHaveAttribute('data-state', 'synced');
  return editor;
}
test('Traditional Chinese populated workspace, readable mobile document and real shared ledger', async ({ page, browser }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  const fullBackgroundRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/background-\d\d\.webp$/.test(request.url())) fullBackgroundRequests.push(request.url()); });
  await page.goto('/');
  const background = await page.request.get('/backgrounds/background-01.webp');
  expect(background.status()).toBe(200);
  expect(background.headers()['content-type']).toBe('image/webp');
  await expect(page).toHaveTitle('抽獎NOTE');
  await page.getByLabel('你的名字', { exact: true }).fill('小安');
  await page.getByLabel('Email', { exact: true }).fill(`demo-${randomUUID()}@example.test`);
  await page.getByLabel('密碼', { exact: true }).fill('Synthetic-Demo-Password-2026');
  await page.getByRole('button', { name: '建立我的空間', exact: true }).click();
  await expect(page.getByLabel('搜尋筆記')).toBeVisible();
  const session = await (await page.request.get('/api/session')).json();
  const headers = { 'X-CSRF-Token': session.csrfToken, Origin: 'http://127.0.0.1:4318' };
  async function post(path: string, data: object) {
    const response = await page.request.post(path, { headers, data });
    expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
    return response.json();
  }
  const { workspace } = await post('/api/workspaces', { name: '京都散步計畫', type: 'group' });
  const participants = [session.user.id];
  for (const name of ['阿晴', '阿哲']) {
    const other = await browser.newContext();
    const email = `demo-${randomUUID()}@example.test`;
    const response = await other.request.post('http://127.0.0.1:4318/api/auth/register', {
      headers: { Origin: 'http://127.0.0.1:4318' }, data: { name, email, password: 'Synthetic-Demo-Password-2026' },
    });
    expect(response.status()).toBe(201);
    participants.push((await response.json()).user.id);
    await post(`/api/workspaces/${workspace.id}/members`, { email, role: 'editor' });
    await other.close();
  }
  const { notebook } = await post(`/api/workspaces/${workspace.id}/notebooks`, { name: '旅行手帳' });
  const examples = [
    { title: '京都採買｜把心意帶回家', template: 'shopping', tags: ['伴手禮', '京都', 'status:doing'], content: '# 今天的採買路線\n錦市場 → 茶屋 → 文具店，慢慢逛，不趕路。\n# 伴手禮清單\n- [x] 宇治抹茶｜2 盒｜JPY 1,200｜送家人\n- [ ] 手作茶杯｜1 個｜JPY 2,800｜留給自己\n- [ ] 和紙筆記本｜3 本｜JPY 600｜送朋友\n- [ ] 季節和菓子｜1 盒｜JPY 1,600｜大家分享\n# 小提醒\n先確認保存期限，再一起整理收據。\n預算：JPY 10,000；分帳本另外記錄 TWD 費用，不自動換匯。' },
    { title: '出門前的 10 分鐘｜行前 SOP', template: 'sop', tags: ['行前準備', 'status:todo'], content: '# 版本與完成條件\n版本：1.0｜負責人：小安\n完成條件：證件、電力與訂位資料均完成雙人確認。\n# 出發前一起確認\n- [x] 護照與交通票券放入隨身包\n- [ ] 行動電源充飽，線材放同一袋\n- [ ] 下載住宿地址與緊急聯絡資訊\n- [ ] 檢查瓦斯、門窗，再拍照留存\n# 交接備註\n阿晴確認訂位，阿哲負責交通路線。' },
    { title: '週末待辦｜把旅行慢慢準備好', template: 'tasks', tags: ['待辦', 'status:todo'], content: '# 今天只做三件事\n- [x] 確認大家的出發時間\n- [ ] 整理共同購物清單\n- [ ] 討論雨天的室內備案\n# 截止時間\n週五晚餐前一起確認。' },
    { title: '第一天｜在鴨川邊散步', template: 'travel', tags: ['行程', 'status:done'], content: '# 抵達京都的第一天\n10:30 放好行李，喝杯熱茶。\n12:00 錦市場午餐與採買。\n15:30 沿著鴨川散步，留下照片和手寫心情。\n# 旅程原則\n每一天只安排一件最想做的事。\n保留迷路與休息的空白。' },
  ];
  for (const example of examples) await post(`/api/workspaces/${workspace.id}/notes`, { ...example, notebookId: notebook.id, clientMutationId: randomUUID() });
  await post(`/api/workspaces/${workspace.id}/expenses`, { description: '京都住宿｜共同房費', amount: 360000, currency: 'TWD', payerId: participants[0], participantIds: participants, clientMutationId: randomUUID() });
  await post(`/api/workspaces/${workspace.id}/expenses`, { description: '機場交通｜三人車資', amount: 90000, currency: 'TWD', payerId: participants[1], participantIds: participants, clientMutationId: randomUUID() });
  await page.reload();
  await page.getByLabel('選擇工作空間').selectOption(workspace.id);
  await expect(page.getByRole('button', { name: /京都採買｜把心意帶回家/ })).toBeVisible();
  await page.getByRole('button', { name: /京都採買｜把心意帶回家/ }).click();
  await expect(page.getByLabel('文件編輯器')).toBeVisible();
  const desktopEditor = await syncedEditor(page);
  await expect(page.getByLabel('Markdown 內容')).not.toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(4);
  mkdirSync('docs/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/desktop-note-zh.png', fullPage: true });
  for (const width of [320, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await desktopEditor.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
  const mobileParagraph = desktopEditor.locator('p').filter({ hasText: /\S/ }).first();
  await mobileParagraph.scrollIntoViewIfNeeded();
  await expect(mobileParagraph).toBeInViewport();
  const paragraphSize = await mobileParagraph.evaluate(node => ({ client: node.clientWidth, scroll: node.scrollWidth, lineHeight: parseFloat(getComputedStyle(node).lineHeight), height: node.getBoundingClientRect().height }));
  expect(paragraphSize.scroll).toBeLessThanOrEqual(paragraphSize.client + 1);
  expect(paragraphSize.height).toBeGreaterThanOrEqual(paragraphSize.lineHeight - 1);
  await page.screenshot({ path: 'docs/screenshots/mobile-shopping-zh.png', fullPage: true });
  await page.getByLabel('關閉筆記').click();
  await page.getByLabel('開啟選單').click();
  await page.getByRole('button', { name: '任務看板', exact: true }).click();
  await expect(page.locator('.kanban-card')).toHaveCount(4);
  await page.screenshot({ path: 'docs/screenshots/mobile-board-zh.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '分帳本', exact: true }).click();
  await expect(page.getByText('京都住宿｜共同房費')).toBeVisible();
  await expect(page.getByText('機場交通｜三人車資')).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/desktop-ledger-zh.png', fullPage: true });
  await page.getByRole('button', { name: /偏好設定與個人資料/ }).click();
  await expect(page.locator('.gallery-background-option')).toHaveCount(10);
  await page.getByRole('button', { name: '選擇背景：霧林', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/image-background/);
  for (const mode of ['深色', '淺色']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    const contrast = await page.evaluate(() => {
      const element = document.createElement('span');
      element.style.color = 'var(--muted)'; element.style.backgroundColor = 'var(--surface)';
      document.body.append(element);
      const style = getComputedStyle(element);
      const luminance = (color: string) => {
        const values = color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
        return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
      };
      const a = luminance(style.color), b = luminance(style.backgroundColor); element.remove();
      return (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
    });
    expect(contrast, mode + ' muted text / surface contrast').toBeGreaterThanOrEqual(4.5);
  }
  await expect.poll(() => new Set(fullBackgroundRequests).size).toBe(1);
  await page.screenshot({ path: 'docs/screenshots/background-gallery-zh.png', fullPage: true });
  const storageState = await page.context().storageState();
  const iphone = devices['iPhone 16 Pro Max'];
  const landscape = devices['iPhone 16 Pro Max landscape'];
  const iphoneScreen = (iphone as typeof iphone & { screen: { width: number; height: number } }).screen;
  const layouts = [
    { name: 'iphone16-pro-max-portrait', viewport: iphone.viewport, screen: iphoneScreen, deviceScaleFactor: iphone.deviceScaleFactor, source: 'Installed Playwright device descriptor; Chromium layout simulation, not physical Safari.' },
    { name: 'iphone16-pro-max-landscape', viewport: landscape.viewport, screen: iphoneScreen, deviceScaleFactor: landscape.deviceScaleFactor, source: 'Installed Playwright landscape descriptor; Chromium layout simulation.' },
    { name: 'iphone16-pro-max-pwa-layout', viewport: { width: 440, height: 956 }, screen: iphoneScreen, deviceScaleFactor: 3, source: 'Full-screen CSS layout assumption; not an installed PWA verification.' },
    { name: 'iphone16-pro-max-pwa-landscape-layout', viewport: { width: 956, height: 440 }, screen: iphoneScreen, deviceScaleFactor: 3, source: 'Full-screen landscape CSS layout assumption; not an installed PWA verification.' },
    { name: 'galaxy-s26-360-portrait', viewport: { width: 360, height: 780 }, screen: { width: 360, height: 780 }, deviceScaleFactor: 3, source: 'Galaxy S26 synthetic adaptation assumption, not a verified physical CSS viewport.' },
    { name: 'galaxy-s26-360-landscape', viewport: { width: 780, height: 360 }, screen: { width: 360, height: 780 }, deviceScaleFactor: 3, source: 'Galaxy S26 synthetic landscape adaptation assumption.' },
    { name: 'galaxy-s26-412-portrait', viewport: { width: 412, height: 892 }, screen: { width: 412, height: 892 }, deviceScaleFactor: 2.625, source: 'Galaxy S26 display-zoom adaptation assumption, not a verified physical CSS viewport.' },
    { name: 'galaxy-s26-412-landscape', viewport: { width: 892, height: 412 }, screen: { width: 412, height: 892 }, deviceScaleFactor: 2.625, source: 'Galaxy S26 synthetic landscape display-zoom adaptation assumption.' },
  ];
  writeFileSync('artifacts/device-layout-matrix.json', JSON.stringify({ browserEngine: 'Chromium', physicalDeviceTested: false, layouts }, null, 2));
  for (const layout of layouts) {
    const context = await browser.newContext({ storageState, viewport: layout.viewport, screen: layout.screen, deviceScaleFactor: layout.deviceScaleFactor, isMobile: true, hasTouch: true });
    const phone = await context.newPage();
    await phone.goto('http://127.0.0.1:4318/');
    if (await phone.getByLabel('開啟選單').isVisible()) await phone.getByLabel('開啟選單').tap();
    await phone.getByLabel('選擇工作空間').selectOption(workspace.id);
    await phone.getByRole('button', { name: /京都採買｜把心意帶回家/ }).tap();
    await expect(phone.getByLabel('文件編輯器')).toBeVisible();
    const phoneEditor = await syncedEditor(phone);
    expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(layout.viewport.width + 1);
    await phone.screenshot({ path: `docs/screenshots/${layout.name}.png`, fullPage: true });
    if (layout.name === 'iphone16-pro-max-portrait' || layout.name === 'galaxy-s26-360-portrait') {
      await phone.setViewportSize({ width: layout.viewport.width, height: 500 });
      const paragraph = phoneEditor.locator('p').filter({ hasText: /\S/ }).last();
      await paragraph.scrollIntoViewIfNeeded();
      await expect(paragraph).toBeInViewport();
      await paragraph.tap();
      await phone.keyboard.press('ControlOrMeta+End');
      const confirmationText = layout.name === 'iphone16-pro-max-portrait' ? '（iPhone 已確認）' : '（Galaxy 已確認）';
      await phone.keyboard.insertText(confirmationText);
      await expect(phoneEditor).toContainText(confirmationText);
      await expect(phone.locator('.collaboration-status')).toHaveAttribute('data-state', 'synced');
      // Body edits synchronize through CRDT; metadata Save is not their persistence mechanism.
      await expect(phone.getByRole('button', { name: '儲存', exact: true })).toBeDisabled();
    }
    await context.close();
  }
  await page.goto('/viewport-diagnostics.html');
  await expect(page.locator('#diagnostics')).toContainText('visualViewport');
  await page.setViewportSize({ width: 440, height: 500 });
  await expect.poll(async () => JSON.parse((await page.locator('#diagnostics').textContent())!).innerWidth).toBe(440);
  expect(errors).toEqual([]);
});
