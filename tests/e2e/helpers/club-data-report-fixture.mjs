import { build } from 'esbuild';

// Real Data pages, router, URL canonicalizer, redirect and reconciliation UI.
// Only account/server/background I/O is replaced; no production session or writes.
export async function clubDataReportFixture() {
  const stubs = {
    useAuthUser: `export const useAuthUser=()=>({user:{id:'fixture-owner'},isHydrating:false});`,
    usePlayerPreference: `import {useState} from 'react';export function usePlayerPreference(name,initial){const [value,set]=useState(()=>window.fixturePreferences?.[name]??(name.endsWith(':advanced')?false:typeof initial==='function'?initial():initial));return [value,set];}`,
    useClubGameHost: `export const useClubGameHost=()=>'';`,
    usePageTitle: `export const usePageTitle=()=>{};`,
    useMasterBusChannel: `export const useMasterBusChannel=()=>{};`,
    useMasterBusSubscription: `export const useMasterBusSubscriptions=()=>{};export const useMasterBusSubscription=()=>{};`,
    ClubRosterService: `export const ClubRosterService={getDataPlayerMatches:async()=>({items:[]})};`,
    RakeSnapshotPanel: `export default()=>null;`,
    ClubRakebackVerifiedSoFar: `export default()=>null;`,
    ClubHitRunPanel: `export default()=>null;`,
    errorReporter: `export const reportError=()=>{};`,
    supabase: `
      const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const summary={games:194,total_winnings:-7896.86,mtt_winnings:-223.42,cash_winnings:-7673.44,fee:5154.81,cash_fee:5000,mtt_fee:154.81,hands:1000,reconciliation:{complete:true,missing_days:[],bbj_gross:639.04,bbj_awards:0,bbj_net:639.04,cash_fee:5000,cash_winnings:-7673.44,tournament_fee:154.81,tournament_winnings:-223.42,cash_residual:-2034.4,tournament_flow_difference:68.61}};
      const snap={accounting_basis:'union_invoice_accounting',scope:'club',reporting_scope:'union',club_name:'Fixture Union',union_id:id,range:{start:'2026-11-09',end:'2026-11-15',days:7},previous_range:{start:'2026-11-02',end:'2026-11-08',days:7},filters:{game:'ALL',stakes:'ALL',search:null},summary,previous:{...summary,games:1940,fee:10309.62,cash_fee:10154.81,total_winnings:-7481.61,cash_winnings:-7258.19},delta:{fee_pct:-50,games_pct:-90,winnings_abs:-415.25,fee_abs:-5154.81},rows:[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',kind:'CASH',name:'Cross Day Cash',variant:'NLH',game_class:'HOLDEM',stakes_tier:'HIGH',blinds:'5/10',started_at:'2026-11-08T08:00:00Z',activity_at:'2026-11-15T12:00:00Z',status:'COMPLETED',creator_id:null,creator_name:null,creator_avatar:null,rake_percent:5,hands:1000,players:3,fee:5000,fee_exact:5000,winnings:-7673.44,live:false}],row_count:194,data_updated_at:'2026-11-16T08:00:00Z',generated_at:'2026-11-16T08:00:00Z'};
      export const supabase={from(table){const q={select(){return q},eq(){return q},or(){return q},maybeSingle:async()=>({data:table==='unions'?{id,slug:'fixture-union'}:{id,slug:'fixture-union',name:'Fixture Union',is_union:true,union_id:id},error:null})};return q},async rpc(fn,args){window.fixtureReads??=[];window.fixtureReads.push({fn,args});if(fn==='ca_club_union_invoices')return {error:null,data:window.fixtureInvoices??[]};return {error:null,data:fn==='ca_club_data_screen'||fn==='ca_club_data_snapshot_v2'?{...snap,range:{...snap.range,start:args.p_start,end:args.p_end},filters:{game:args.p_game,stakes:args.p_stakes,search:args.p_search}}:fn==='ca_club_game_page'?{contract:'ca_club_game_page.v2',contract_version:2,club_id:id,requested_start:args.p_start,requested_end:args.p_end,requested_game:args.p_game,requested_stakes:args.p_stakes,requested_search:args.p_search,requested_sort:args.p_sort,requested_cursor:args.p_cursor,requested_limit:args.p_limit,sort:args.p_sort,rows:[],next_cursor:null,has_more:false,filtered_count:0,generated_at:snap.generated_at}:fn==='ca_club_player_breakdown'?{range:snap.range,totals:{players:0,net:0,rake:0,hands:0},players:[],player_count:0,generated_at:snap.generated_at}:[]}}};`,
  };
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {BrowserRouter,Routes,Route} from 'react-router-dom';
      import Simple from './src/pages/club/ClubDataSimplePage';
      import Advanced from './src/pages/club/ClubDataPage';
      import Redirect from './src/pages/UnionReportRedirect';
      import SlugEnforcer from './src/components/common/SlugEnforcer';
      createRoot(document.getElementById('root')).render(<BrowserRouter><SlugEnforcer/><Routes>
        <Route path="/clubs/:clubId/data" element={<Simple authorizedScope="club"/>}/>
        <Route path="/clubs/:clubId/data/advanced" element={<Redirect/>}/>
        <Route path="/unions/:unionId/data/advanced" element={<Redirect/>}/>
      </Routes></BrowserRouter>);`,
    },
    bundle: true,
    jsx: 'automatic',
    write: false,
    outdir: process.env.TMPDIR || process.cwd(),
    format: 'iife',
    loader: { '.png': 'dataurl', '.webp': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl' },
    define: { 'import.meta.env': '{"DEV":false,"BASE_URL":"/","VITE_NATIVE":"0"}' },
    external: ['/assets/*', '/fonts/*', 'https://*', '@capacitor/haptics'],
    plugins: [
      {
        name: 'local-data-io',
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) => {
            const key = args.path.split('/').pop();
            if (Object.hasOwn(stubs, key)) return { path: key, namespace: 'fixture' };
          });
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents: stubs[path],
            loader: 'tsx',
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
    logLevel: 'silent',
  });
  return {
    javascript: result.outputFiles.find((f) => f.path.endsWith('.js')).text,
    css: result.outputFiles.find((f) => f.path.endsWith('.css'))?.text || '',
  };
}
