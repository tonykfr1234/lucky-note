import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

function observe(page: Page) {
  const requests: string[] = [], errors: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.includes('/api/')) requests.push(request.url()); });
  page.on('websocket', socket => requests.push(socket.url()));
  page.on('pageerror', error => errors.push(error.message));
  return { requests, errors };
}
async function english(page: Page) {
  await page.addInitScript(() => localStorage.setItem('luckynote.preferences', JSON.stringify({lang:'en',theme:'light',background:0,customBackground:'',brandName:'',brandIcon:''})));
}

test('device build works without account, persists rich text and never contacts a backend', async ({page, context}) => {
  const evidence = observe(page); await english(page); await page.goto('http://127.0.0.1:4320/');
  await expect(page.getByLabel('Search notes', {exact:true})).toBeVisible();
  await expect(page.locator('.note-card')).toHaveCount(0);
  await page.getByRole('button', {name:'New note',exact:true}).filter({visible:true}).first().click();
  await page.getByRole('button', {name:/Travel planner/}).click();
  const editor=page.getByLabel('Note content editor',{exact:true}); await expect(editor).toBeVisible();
  await page.getByLabel('Note title',{exact:true}).fill('Offline travel notebook');
  await expect(page.locator('.collaboration-status')).toHaveAttribute('data-state','synced');
  await editor.click(); await editor.press('ControlOrMeta+A'); await editor.pressSequentially('Device-only saved content'); await editor.press('ControlOrMeta+A');
  await page.getByRole('button',{name:'Bold',exact:true}).click();
  await expect(editor.locator('strong').first()).toContainText('Device-only saved content');
  await expect(page.locator('.collaboration-status')).toHaveAttribute('data-state','synced');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  // Disabled also means "busy". Only the completed transaction is safe to reload.
  await expect(page.locator('.sync-state')).toHaveAttribute('data-state','saved');
  await expect(page.getByRole('button',{name:'Save',exact:true})).toBeDisabled();
  await page.reload(); await page.getByRole('button',{name:/Offline travel notebook/}).click();
  await expect(editor.locator('strong').first()).toContainText('Device-only saved content');
  await context.setOffline(true); await editor.press('End'); await editor.press('Enter'); await editor.pressSequentially('Offline edit persists');
  await expect(page.locator('.collaboration-status')).toHaveAttribute('data-state','synced');
  await context.setOffline(false); await page.reload(); await page.getByRole('button',{name:/Offline travel notebook/}).click();
  await expect(editor).toContainText('Offline edit persists');
  expect(evidence.requests).toEqual([]); expect(evidence.errors).toEqual([]);
});

test('Pages subpath renders populated Traditional Chinese preview and target phone layouts', async ({page}) => {
  const evidence=observe(page); await page.goto('http://127.0.0.1:4321/lucky-note/');
  await expect(page).toHaveTitle('抽獎NOTE');
  await expect(page.locator('.note-card').first()).toBeVisible();
  await page.locator('.note-card').first().click();
  await expect(page.getByLabel('筆記內容編輯器',{exact:true})).toBeVisible();
  await expect(page.locator('.collaboration-status')).toHaveAttribute('data-state','synced');
  mkdirSync('docs/screenshots',{recursive:true});
  for(const [name,width,height] of [['preview-iphone16-pro-max',440,763],['preview-galaxy-s26-360',360,780],['preview-galaxy-s26-412',412,892],['preview-keyboard-stress',360,500]] as const){
    await page.setViewportSize({width,height});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
    await expect(page.locator('.sidebar')).toHaveCSS('visibility','hidden');
    await expect(page.locator('.note-editor .local-mode-banner')).toBeVisible();
    await page.screenshot({path:`docs/screenshots/${name}.png`,fullPage:true});
  }
  expect(evidence.requests).toEqual([]); expect(evidence.errors).toEqual([]);
});

test('local media persists and JSON export/import roundtrip is user-confirmed', async ({page}) => {
  const evidence=observe(page); await english(page); await page.goto('http://127.0.0.1:4320/');
  await page.getByRole('button',{name:'New note',exact:true}).filter({visible:true}).first().click();
  await page.getByRole('button',{name:/Travel planner/}).click();
  await expect(page.locator('.collaboration-status')).toHaveAttribute('data-state','synced');
  await page.locator('input[type=file][accept^="image/png"]').setInputFiles({name:'safe-demo.png',mimeType:'image/png',buffer:readFileSync('public/icon-192.png')});
  await expect(page.locator('.attachment img')).toHaveCount(1);
  await page.reload(); await page.locator('.note-card').first().click();
  await expect(page.locator('.attachment img')).toHaveJSProperty('naturalWidth',192);
  const markdownDownload=page.waitForEvent('download'); await page.getByRole('button',{name:'Export Markdown',exact:true}).click();
  const markdownPath=await(await markdownDownload).path(); expect(readFileSync(markdownPath!,'utf8')).toContain('Trip overview');
  await page.getByRole('button',{name:'Close note',exact:true}).click();
  await page.getByRole('button',{name:'More actions',exact:true}).click();
  const jsonDownload=page.waitForEvent('download'); await page.getByRole('button',{name:'Export notes as JSON',exact:true}).click();
  const jsonPath=await(await jsonDownload).path(); const archive=JSON.parse(readFileSync(jsonPath!,'utf8')); expect(archive.notes).toHaveLength(1);
  page.once('dialog',dialog=>dialog.dismiss()); await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles(jsonPath!);
  await expect(page.locator('.note-card')).toHaveCount(1);
  page.once('dialog',dialog=>dialog.accept()); await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles(jsonPath!);
  await expect(page.locator('.note-card')).toHaveCount(2);
  expect(evidence.requests).toEqual([]); expect(evidence.errors).toEqual([]);
});
