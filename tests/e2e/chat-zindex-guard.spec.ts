/**
 * E2E test verifying chat button z-index ordering.
 * 
 * Ensures the chat button is above the Table HUD layer.
 * 
 * Target z-index for .chat-collapsed: 105
 * Target z-index for .table-hud: 100
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const css = 
  fs.readFileSync(path.join(process.cwd(), 'src/components/table/TableHUD.css'), 'utf8') +
  '\n' +
  fs.readFileSync(path.join(process.cwd(), 'src/components/table/TableChat.css'), 'utf8');

const html = `
<style>${css}</style>
<div class="table-page">
  <div class="table-hud">
    <div class="table-hud__lower">
      <div class="hud-widget" style="z-index: 100;">HUD Widget</div>
    </div>
  </div>
  <button class="chat-collapsed" id="chat">Chat</button>
</div>
`;

test('chat button z-index is higher than HUD', async ({ page }) => {
  await page.setContent(html);
  
  const zIndexChat = await page.evaluate(() => {
    return window.getComputedStyle(document.querySelector('.chat-collapsed')!).zIndex;
  });
  
  const zIndexHud = await page.evaluate(() => {
    return window.getComputedStyle(document.querySelector('.hud-widget')!).zIndex;
  });
  
  expect(parseInt(zIndexChat)).toBe(105);
  expect(parseInt(zIndexChat)).toBeGreaterThan(parseInt(zIndexHud));
});
