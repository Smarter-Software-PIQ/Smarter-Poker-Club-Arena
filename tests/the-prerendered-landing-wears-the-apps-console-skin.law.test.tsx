/**
 * THE PRERENDERED LANDING WEARS THE SKIN THE APP WEARS (2026-11-28)
 *
 * App.tsx dresses every SpadeConsole in the #SmarterDesign skin through one
 * root ConsoleSkinProvider (#12299). The prerender entry renders the public
 * pages without App, so the landing's consoles were written into index.html in
 * the painted dress, and the page a signed-out visitor or a crawler read first
 * was not the page the bundle then drew. The prerender now provides the same
 * skin, and this pins it on the rendered markup itself.
 */
import { describe, expect, it } from 'vitest';
import { renderPublicPage } from '../src/prerender/entry-server';

describe('the prerendered landing', () => {
  it('draws every console in the #SmarterDesign skin, as the running app does', () => {
    const { html } = renderPublicPage('/');
    const consoles = html.match(/class="sc [^"]*"/g) ?? [];
    expect(consoles.length).toBeGreaterThan(0);
    for (const console of consoles) expect(console).toContain('sc--sd');
    expect(html).toContain('data-console-skin="smarterdesign"');
  });
});
