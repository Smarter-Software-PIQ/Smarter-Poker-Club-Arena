import { test, expect } from '@playwright/test';
import { build } from 'esbuild';

/** Real renderer, crown projection and CSS. No purchases or network fixtures. */
export function registerAddOnNoticeContainmentCases() {
  test.describe('add-on notice containment', () => {
    let script: string, css: string;
    test.beforeAll(async () => {
      const result = await build({
        stdin: {
          contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ChatBubble} from './src/components/table/ChatBubble';
          createRoot(document.getElementById('root')).render(<div className="table-page" style={{position:'relative',width:'100%',height:600,overflow:'hidden'}}>{[8,50,92].map((x,i)=><div key={x} className="seat-wrapper" style={{position:'absolute',left:x+'%',top:i===1?100:300,width:90,height:120,transform:'translate(-50%,-50%) scale(.8)'}}><div className="seat" style={{position:'relative',width:90,height:120}}><div className="seat__avatar-wrap"><img className="seat__avatar-img" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Ccircle cx='40' cy='40' r='38' fill='%231877f2'/%3E%3C/svg%3E" style={{position:'absolute',top:0,left:5,width:80,height:80}} /></div><div className="seat__info" style={{position:'absolute',top:80,width:90,textAlign:'center',color:'white'}}><div>Player {i+1}</div><span className="seat__stack">400</span></div></div><ChatBubble text="+1,234,567.89 Added On" playerName="Player" variant="notice" placement={i===1?'below':'above'} /></div>)}</div>);`,
          resolveDir: process.cwd(),
          loader: 'tsx',
        },
        bundle: true,
        write: false,
        outdir: 'fixture-output',
        format: 'iife',
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"' },
      });
      script = result.outputFiles.find((f) => f.path.endsWith('.js'))!.text;
      css = result.outputFiles.find((f) => f.path.endsWith('.css'))!.text;
    });
    for (const width of [375, 393, 1000])
      test(`bank-to-crown flight stays inside the ${width}px pane and disappears`, async ({
        page,
      }, info) => {
        await page.setViewportSize({ width, height: 812 });
        await page.setContent(
          `<style>*{box-sizing:border-box}body{margin:0;font-family:Arial;background:#000}${css}#root{width:${width}px}</style><div id="root"></div>`
        );
        await page.addScriptTag({ content: script });
        const flights = page.locator('.add-on-flight');
        await expect(flights).toHaveCount(3);
        const seek = async (time: number) => {
          await flights.evaluateAll(
            (nodes, time) =>
              nodes.forEach((n) =>
                n.getAnimations().forEach((a) => {
                  a.pause();
                  a.currentTime = time;
                })
              ),
            time
          );
        };
        await seek(0);
        for (const n of await flights.all()) {
          const r = await n.evaluate((n) => {
            const bank = n.parentElement!.querySelector('.seat__stack')!.getBoundingClientRect();
            const r = n.getBoundingClientRect();
            return { center: r.top + r.height / 2, bank: bank.top + bank.height / 2 };
          });
          expect(Math.abs(r.center - r.bank)).toBeLessThan(1);
        }
        await seek(680);
        const verify = async () => {
          for (const n of await flights.all()) {
            const r = await n.evaluate((n) => {
              const box = n.getBoundingClientRect(),
                pane = n.closest('.table-page')!.getBoundingClientRect();
              const avatar = n
                .parentElement!.querySelector('.seat__avatar-img')!
                .getBoundingClientRect();
              return {
                left: box.left,
                right: box.right,
                bottom: box.bottom,
                top: pane.top,
                paneLeft: pane.left,
                paneRight: pane.right,
                crown: avatar.top,
                opacity: getComputedStyle(n).opacity,
                background: getComputedStyle(n).backgroundColor,
                scroll: n.scrollWidth,
                width: n.clientWidth,
              };
            });
            expect(r.left).toBeGreaterThanOrEqual(r.paneLeft);
            expect(r.right).toBeLessThanOrEqual(r.paneRight);
            expect(r.bottom).toBeLessThan(r.crown);
            expect(r.opacity).toBe('1');
            expect(r.background).toBe('rgba(0, 0, 0, 0)');
            expect(r.scroll).toBeLessThanOrEqual(r.width + 1);
          }
        };
        await verify();
        await info.attach('flight-above-crown.png', {
          body: await page.screenshot({ path: info.outputPath('flight.png') }),
          contentType: 'image/png',
        });
        await page.setViewportSize({ width: 1000, height: 812 });
        await page.locator('#root').evaluate((n) => {
          n.style.width = '240px';
          n.style.marginLeft = '123px';
        });
        await expect
          .poll(async () => flights.first().evaluate((n) => parseFloat(n.style.maxWidth)))
          .toBeLessThan(300);
        await verify();
        await seek(800);
        for (const n of await flights.all()) await expect(n).toHaveCSS('opacity', '0');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await seek(400);
        for (const n of await flights.all()) await expect(n).toHaveCSS('opacity', '1');
        await seek(800);
        for (const n of await flights.all()) await expect(n).toHaveCSS('opacity', '0');
      });
  });
}
