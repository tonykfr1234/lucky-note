import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
try {
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().startsWith('https://appassets.androidplatform.net/'));
  assert.ok(page, 'Bundled WebView page must exist.');
  await page.waitForFunction(() => document.body.innerText.includes('抽獎NOTE'), { timeout: 30000 });
  assert.equal(await page.evaluate(() => location.origin), 'https://appassets.androidplatform.net');
  assert.equal(await page.evaluate(() => typeof window.LuckyNoteExport?.postMessage), 'function');
  // A fresh CI emulator contains only test data. This verifies storage survives WebView reload.
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('luckynote-android-smoke', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('checks');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('checks', 'readwrite');
        tx.objectStore('checks').put('persisted', 'reload');
        tx.oncomplete = () => { open.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  await page.waitForFunction(() => document.body.innerText.includes('抽獎NOTE'));
  const stored = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('luckynote-android-smoke', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('checks', 'readonly');
      const request = tx.objectStore('checks').get('reload');
      request.onsuccess = () => resolve(request.result);
      tx.oncomplete = () => { open.result.close(); indexedDB.deleteDatabase('luckynote-android-smoke'); };
    };
  }));
  assert.equal(stored, 'persisted');
  console.log('PASS: bundled local page, export channel present, IndexedDB persisted after reload.');
  console.log('NOT RUN: physical Samsung device, camera app, system save/cancel UI, native keyboard/safe area.');
} finally { await browser.close(); }
