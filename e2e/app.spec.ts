import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
test.beforeEach(async ({page}) => { page.on('pageerror', error => console.log('UI runtime error:', error.message)); });

async function english(page: Page) {
  await page.addInitScript(() => { if(!localStorage.getItem('luckynote.preferences')) localStorage.setItem('luckynote.preferences', JSON.stringify({lang:'en', theme:'light', background:0, customBackground:'', brandName:'', brandIcon:''})); });
}
async function register(page: Page) {
  await english(page); await page.goto('/');
  await page.getByLabel('Your name', { exact: true }).fill('Mina');
  await page.getByLabel('Email', { exact: true }).fill(`ui-${randomUUID()}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Local-Test-Passphrase-2026');
  await page.getByRole('button', {name:'Create my space', exact:true}).click();
  await expect(page.getByLabel('Search notes', {exact:true})).toBeVisible();
}
async function newTravel(page: Page) {
  await page.getByRole('button', { name: 'New note', exact: true }).filter({visible:true}).first().click();
  await page.getByRole('button', {name:/Travel planner/}).click();
  await expect(page.getByLabel('Note title', {exact:true})).toBeVisible();
}
async function noOverflow(page: Page) {
  const size = await page.evaluate(() => ({width:innerWidth, scroll:document.documentElement.scrollWidth}));
  expect(size.scroll, `horizontal overflow at width ${size.width}`).toBeLessThanOrEqual(size.width + 1);
}
test('real registration, editable template, save, persistence, search and empty state', async ({page}) => {
  const crashes: string[] = []; page.on('pageerror', error => crashes.push(error.message));
  await register(page); await newTravel(page);
  await page.getByLabel('Note title', {exact:true}).fill('Kyoto / shared memories');
  await page.getByRole('button', {name:'Markdown', exact:true}).click();
  await page.getByLabel('Markdown content').fill('# Kyoto travel plan\n- [ ] Book train\n- [ ] Tea for friends | Qty: 2 | Currency: JPY | Status: pending\n');
  await page.getByLabel('Tags (comma separated)').fill('travel, 2026');
  await page.getByRole('button', {name:'Save', exact:true}).click();
  await expect(page.getByRole('button', {name:'Save', exact:true})).toBeDisabled();
  await page.reload();
  await page.getByRole('button', {name:/Kyoto \/ shared memories/}).click();
  await expect(page.getByLabel('Note title')).toHaveValue('Kyoto / shared memories');
  await page.getByRole('button', {name:'Markdown', exact:true}).click();
  await expect(page.getByLabel('Markdown content')).toHaveValue(/Book train/);
  mkdirSync('artifacts', {recursive:true});
  await page.screenshot({path:'artifacts/desktop-editor.png', fullPage:true});
  await noOverflow(page);
  expect(crashes).toEqual([]);
});

test('desktop and phone layouts, cancellation, settings, branding and dark mode', async ({page}) => {
  await register(page);
  for (const width of [320,390,430,768,1024,1440]) {
    await page.setViewportSize({width,height:900});
    await noOverflow(page);
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button', {name:'New note', exact:true}).filter({visible:true}).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const spaces = await (await page.request.get('/api/workspaces')).json();
  const notes = await (await page.request.get(`/api/workspaces/${spaces.workspaces[0].id}/notes`)).json();
  expect(notes.notes).toHaveLength(0);
  await page.getByLabel('Search notes').fill('does-not-exist');
  await expect(page.locator('.empty-state')).toBeVisible();
  await page.getByLabel('Search notes').fill('');
  await page.getByRole('button', {name:/Settings & profile/}).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', {name:'Dark',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.locator('.background-option')).toHaveCount(10);
  await page.getByLabel('App name', {exact:true}).fill('Our little notebook');
  await expect(page).toHaveTitle('Our little notebook');
  await page.setViewportSize({width:390,height:844});
  await noOverflow(page);
  await page.screenshot({path:'artifacts/mobile-settings-dark.png',fullPage:true});
  await page.getByLabel('Close settings').click();
  await page.screenshot({path:'artifacts/mobile-home.png',fullPage:true});
  await page.reload();
  await expect(page).toHaveTitle('Our little notebook');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
});

test('handwriting undo/redo saves editable strokes and protected PNG attachment', async ({page}) => {
  await register(page); await newTravel(page);
  await page.getByRole('button',{name:'Sketch',exact:true}).click();
  const canvas = page.getByLabel('Freehand drawing canvas');
  const box = await canvas.boundingBox(); expect(box).not.toBeNull();
  await page.mouse.move(box!.x+50,box!.y+80); await page.mouse.down();
  await page.mouse.move(box!.x+220,box!.y+160,{steps:12}); await page.mouse.up();
  await page.getByRole('button',{name:/Undo/}).click();
  await page.getByRole('button',{name:/Redo/}).click();
  await page.getByRole('button',{name:'Save to note',exact:true}).click();
  await expect(page.getByLabel('Freehand drawing canvas')).not.toBeVisible();
  await expect(page.locator('.attachment img')).toHaveCount(1);
  await page.getByRole('button',{name:'Edit sketch',exact:true}).click();
  await expect(page.getByLabel('Freehand drawing canvas')).toBeVisible();
  const rendered = await page.getByLabel('Freehand drawing canvas').evaluate((node: HTMLCanvasElement) => {
    const pixels=node.getContext('2d')!.getImageData(0,0,node.width,node.height).data;
    for(let i=0;i<pixels.length;i+=4) if(pixels[i]<100&&pixels[i+1]<150&&pixels[i+3]>0) return true;
    return false;
  });
  expect(rendered).toBe(true);
  await page.getByLabel('Close sketchpad').click();
});

test('conflicting update preserves the browser draft and PWA avoids private caches', async ({page}) => {
  await register(page); await newTravel(page);
  const session=await (await page.request.get('/api/session')).json();
  const spaces=await (await page.request.get('/api/workspaces')).json();
  const list=await (await page.request.get(`/api/workspaces/${spaces.workspaces[0].id}/notes`)).json();
  const note=list.notes[0];
  await page.getByLabel('Note title').fill('My unsaved draft');
  const response=await page.request.patch(`/api/notes/${note.id}`,{headers:{'X-CSRF-Token':session.csrfToken,Origin:'http://127.0.0.1:4318'},data:{...note,title:'Remote collaborator version',version:note.version}});
  expect(response.ok()).toBeTruthy();
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByLabel('Note title')).toHaveValue('My unsaved draft');
  await expect(page.getByRole('button',{name:'Download my draft',exact:true})).toBeVisible();
  const manifest=await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  const privateCached=await page.evaluate(async()=>{const keys=await caches.keys();const all=await Promise.all(keys.map(async key=>(await(await caches.open(key)).keys()).map(r=>r.url)));return all.flat().filter(url=>new URL(url).pathname.startsWith('/api/'));});
  expect(privateCached).toEqual([]);
});
