import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Actual ledger/card components and CSS; only service and navigation IO are isolated. */
export function registerMissionTextReflowCases() {
  test('monthly challenge ledger fits 200 percent text at 320px', async ({ page }, info) => {
    const result = await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: 'tsx',
        contents: `
          import React from 'react';
          import {createRoot} from 'react-dom/client';
          import {MissionLedgerList} from './src/components/challenges/dashboard/MissionLedgerList';
          import {MissionCycleRail} from './src/components/challenges/dashboard/MissionCycleRail';
          import styles from './src/pages/DailyChallengesPage.module.css';
          const noop=()=>{};
          const row={id:'monthly-full-house',tier:'monthly',progress:0,completed:false,claimed:false,
            challenge:{type:'strong_hands',name:'Monthly Full House',description:'Win 25 Hands With A Full House Or Better',requirement:25,diamondReward:2500}};
          createRoot(document.getElementById('root')).render(
            <main id="daily-missions" className={styles.container}>
              <section className={styles.missionBoard} aria-label="Monthly Challenge Ledger">
                <header className={styles.boardHeader}><div><h2>Monthly Challenge Ledger</h2></div></header>
                <MissionCycleRail activeTier="monthly" tierCounts={{daily:{total:5,done:0},weekly:{total:5,done:0},monthly:{total:5,done:0}}} onOpenTier={noop} onTierKeyDown={noop}/>
                <MissionLedgerList visible={[row]} activeTier="monthly" loadError={null} isRefreshing={false}
                  onRefresh={noop} claimingIds={new Set()} rerollingIds={new Set()} economyBusy={false}
                  diamondBalance={100} confirmingRerollId={null} celebratingIds={new Set()} reduceMotion={true}
                  onClaim={noop} onRequestReroll={noop} onCancelReroll={noop} onConfirmReroll={noop} onOpenMission={noop}/>
              </section>
            </main>);
        `,
      },
      bundle: true,
      write: false,
      outdir: 'fixture-output',
      format: 'iife',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"BASE_URL":"/"}' },
      external: ['/assets/*', '/fonts/*', 'https://*'],
      plugins: [
        {
          name: 'no-ledger-io',
          setup(builder) {
            builder.onLoad({ filter: /DailyChallengesPage\.module\.css$/ }, (args) => ({
              contents: readFileSync(args.path, 'utf8').replace(
                /@import '([^']+)';/g,
                (_, relative) => readFileSync(resolve(dirname(args.path), relative), 'utf8')
              ),
              loader: 'local-css',
              resolveDir: dirname(args.path),
            }));
            builder.onResolve({ filter: /(?:DailyChallengeService|ChunkPreloader)$/ }, (args) => ({
              path: args.path,
              namespace: 'fixture',
            }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
              contents: args.path.endsWith('DailyChallengeService')
                ? 'export const DAILY_MISSION_REROLL_COST=1;'
                : 'export const prefetchIntent=()=>({});',
              loader: 'js',
            }));
          },
        },
      ],
    });
    const css = result.outputFiles.find((f) => f.path.endsWith('.css'))!.text;
    const javascript = result.outputFiles.find((f) => f.path.endsWith('.js'))!.text;
    await page.setViewportSize({ width: 320, height: 568 });
    await page.setContent(
      `<style>*{box-sizing:border-box}html{font-size:200%}body{margin:0;background:#000}#root{margin-inline:24px}${css}</style><div id="root"></div>`
    );
    await page.addScriptTag({ content: javascript });
    await expect(page.getByRole('heading', { name: 'Monthly Full House' })).toBeVisible();
    expect((await page.locator('article').boundingBox())?.width).toBe(228);
    const overflow = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '#daily-missions section, #daily-missions article, #daily-missions article div, #daily-missions button'
        )
      )
        .filter((e) => e.scrollWidth > e.clientWidth + 1)
        .map((e) => ({
          className: e.className,
          text: e.textContent?.slice(0, 90),
          width: e.clientWidth,
          scroll: e.scrollWidth,
        }))
    );
    await info.attach('monthly-text-reflow.png', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    expect(overflow).toEqual([]);
    await expect(page.getByRole('group', { name: 'Challenge Reward' })).toContainText(
      '2,500 Diamonds'
    );
    expect(
      await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))
    ).toBe(32);
  });
}
