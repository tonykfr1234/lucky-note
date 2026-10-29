import { test, expect } from '@playwright/test';

test('metadata remains pending until the storage transaction commits, then survives reload', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('luckynote.preferences', JSON.stringify({lang:'en',theme:'light'})));
  await page.goto('http://127.0.0.1:4320/');
  await page.getByRole('button', {name:'New note',exact:true}).filter({visible:true}).first().click();
  await page.getByRole('button', {name:/Travel planner/}).click();
  await expect(page.locator('.collaboration-status')).toHaveAttribute('data-state','synced');
  await page.getByLabel('Note title',{exact:true}).fill('Commit before reload');
  await page.getByLabel('Tags (comma separated)',{exact:true}).fill('regression, saved');
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    let delayNextWrite = true;
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
      const tx = original.apply(this,args);
      if (delayNextWrite && args[1] === 'readwrite') {
        delayNextWrite = false;
        // Keep the real transaction active: this is slower storage, not a mocked success.
        const until = performance.now() + 700;
        const hold = () => {
          const request = tx.objectStore(tx.objectStoreNames[0]).get('__test_pending_commit__');
          request.onsuccess = () => { if(performance.now() < until) hold(); };
        };
        hold();
      }
      return tx;
    };
  });
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('.sync-state')).toHaveAttribute('data-state','saving');
  await expect(page.getByRole('button',{name:'Saving…',exact:true})).toHaveAttribute('aria-busy','true');
  await expect(page.locator('.sync-state')).toHaveAttribute('data-state','saved');
  await expect(page.getByRole('button',{name:'Save',exact:true})).toHaveAttribute('aria-busy','false');
  await page.reload();
  await page.getByRole('button',{name:/Commit before reload/}).click();
  await expect(page.getByLabel('Tags (comma separated)',{exact:true})).toHaveValue('regression, saved');
});

test('phone, desktop and landscape editing retains reachable controls and visible keyboard focus', async ({ page }) => {
  await page.addInitScript(()=>localStorage.setItem('luckynote.preferences',JSON.stringify({lang:'en',theme:new URL(location.href).searchParams.get('ui-theme')||'light'})));
  for(const theme of ['light','dark']) {
    for(const [width,height] of [[360,780],[412,892],[440,956],[1440,1000],[844,390]]) {
      await page.setViewportSize({width,height});
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.goto('http://127.0.0.1:4321/lucky-note/?ui-theme='+theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
      await page.locator('.note-card').first().click();
      await expect(page.locator('.collaboration-status')).toHaveAttribute('data-state','synced');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
      const controls=page.locator('.rich-toolbar button,.rich-toolbar select');
      for(const control of await controls.all()) {
        const box=await control.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      const bold=page.getByRole('button',{name:'Bold',exact:true});
      await bold.focus();
      await page.keyboard.press('Tab');
      expect(await page.evaluate(()=>getComputedStyle(document.activeElement!).outlineStyle)).toBe('solid');
      await expect(page.getByRole('button',{name:'Document',exact:true})).toHaveAttribute('aria-pressed','true');
      await page.getByRole('button',{name:'Markdown',exact:true}).click();
      await expect(page.getByRole('button',{name:'Markdown',exact:true})).toHaveAttribute('aria-pressed','true');
      await expect(page.getByLabel('Markdown content',{exact:true})).toBeVisible();
    }
  }
});
