#!/usr/bin/env python3
"""Isolated PG17: actual installed member RPC preimages and candidate migration.
Auth, funded-club resolver and unrelated money collaborators are explicit adapters;
real daily aggregates, timestamped hands, fee receipts, sharing and RPCs execute.
No live writes. Use --scratch on the external SSD and PG_BIN for native binaries.
"""
import argparse,json,os,subprocess,tempfile,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
FIX=ROOT/'scripts/ci/fixtures/member-stats-chicago'
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--scratch',type=Path,required=True);ap.add_argument('--migration',type=Path,required=True);a=ap.parse_args()
 pg=Path(os.environ.get('PG_BIN','/opt/homebrew/opt/postgresql@17/bin'))
 w=Path(tempfile.mkdtemp(prefix='mc-',dir=a.scratch.resolve()));data=w/'data';started=False
 def run(cmd,sql=None):
  r=subprocess.run(list(map(str,cmd)),input=sql,text=True,capture_output=True,timeout=120)
  if r.returncode:raise RuntimeError(r.stderr[-6000:])
  return r.stdout.strip()
 ps=[pg/'psql','-XqAt','-v','ON_ERROR_STOP=1','-h',w,'-U','postgres','-d','postgres']
 def q(s):return run(ps,s)
 def yes(s):assert q(s)=='t',s
 c="md5('club')::uuid";u="md5('user')::uuid";other="md5('other')::uuid"
 def seed(day):
  q('TRUNCATE ca_hand_facts,member_record_daily_facts,rake_attributions,rake_records,accounting_tournament_fee_sources,ca_club_rake_daily_user,ca_club_member_tournament_fee_daily,chip_transactions,test_money;')
  q(f"""WITH b AS(SELECT '{day}'::date::timestamp AT TIME ZONE 'America/Chicago' s,('{day}'::date+1)::timestamp AT TIME ZONE 'America/Chicago' e), times AS(
   SELECT s-interval '1 microsecond' ts FROM b UNION SELECT s FROM b UNION SELECT e-interval '1 microsecond' FROM b UNION SELECT e FROM b
   UNION SELECT generate_series(s+interval '30 minutes',e-interval '1 minute',interval '1 hour') FROM b
  ) INSERT INTO ca_hand_facts SELECT md5(ts::text)::uuid,{u},{c},md5('table')::uuid,CASE WHEN row_number()OVER(ORDER BY ts)%3=0 THEN md5('mtt')::uuid END,ts,'nlh',row_number()OVER(ORDER BY ts),0.23,true,true,true,true,true,true,true FROM times;
  INSERT INTO member_record_daily_facts SELECT club_id,user_id,(played_at AT TIME ZONE 'UTC')::date,game_variant,tournament_id IS NOT NULL,count(*),count(*)FILTER(WHERE net>0),count(*),count(*),count(*),count(*),count(*),count(*),count(*),sum(rake_paid),sum(net),NULL FROM ca_hand_facts GROUP BY 1,2,3,4,5;
  INSERT INTO rake_records SELECT hand_id,played_at FROM ca_hand_facts;
  INSERT INTO rake_attributions SELECT hand_id,club_id,user_id,hand_id,played_at,rake_paid FROM ca_hand_facts;
  INSERT INTO ca_club_rake_daily_user SELECT club_id,player_id,(created_at AT TIME ZONE 'UTC')::date,sum(round(rake_amount*100)) FROM rake_attributions GROUP BY 1,2,3;
  INSERT INTO accounting_tournament_fee_sources SELECT club_id,user_id,played_at,0.37,md5('mtt')::uuid FROM ca_hand_facts;
  INSERT INTO ca_club_member_tournament_fee_daily SELECT club_id,player_id,(charged_at AT TIME ZONE 'UTC')::date,sum(rake_credit) FROM accounting_tournament_fee_sources GROUP BY 1,2,3;
  INSERT INTO chip_transactions SELECT club_id,user_id,NULL,'rakeback',1,played_at FROM ca_hand_facts;
  INSERT INTO test_money SELECT club_id,user_id,played_at,2 FROM ca_hand_facts;
  """)
 def args(day):return f"{c},{u},'{day}','{day}'"
 def expected(day):return f"SELECT * FROM ca_hand_facts WHERE played_at>='{day}'::date::timestamp AT TIME ZONE 'America/Chicago' AND played_at<('{day}'::date+1)::timestamp AT TIME ZONE 'America/Chicago'"
 try:
  run([pg/'initdb','-D',data,'-U','postgres','--auth-local=trust','--auth-host=reject','--no-locale','-E','UTF8'])
  with(data/'postgresql.conf').open('a')as f:f.write("\nlisten_addresses=''\nunix_socket_directories='"+str(w)+"'\ntimezone='UTC'\nshared_buffers='16MB'\n")
  run([pg/'pg_ctl','-D',data,'-l',w/'postgres.log','-w','start']);started=True
  q((FIX/'bootstrap.sql').read_text())
  before=json.loads((FIX/'functions-before.json').read_text());q(''.join(s+';\n'for s in before.values()))
  q(f"INSERT INTO club_members(user_id,club_id,role,status)VALUES({u},{c},'owner','active');INSERT INTO profiles(id,alias)VALUES({u},'Fixture');INSERT INTO clubs VALUES({c},'Fixture');")
  seed('2026-11-01')
  yes(f"SELECT (public.ca_club_member_detail({args('2026-11-01')})->'stats'->>'claimed_back')::numeric IS DISTINCT FROM (SELECT count(*) FROM({expected('2026-11-01')})e)")
  print('PASS preimage reproduces UTC day defect')
  q(a.migration.read_text())
  for day,hours in [('2026-03-08',23),('2026-11-01',25),('2027-03-14',23),('2026-10-31',24),('2026-11-02',24)]:
   seed(day)
   yes(f"SELECT extract(epoch FROM (('{day}'::date+1)::timestamp AT TIME ZONE 'America/Chicago')-('{day}'::date::timestamp AT TIME ZONE 'America/Chicago'))/3600={hours}")
   raw=expected(day)
   yes(f"SELECT (SELECT sum(hands) FROM ca_member_record_chicago_facts({args(day)}))=(SELECT count(*)FROM({raw})e)")
   yes(f"SELECT (ca_club_member_statistics({c},{u},NULL,'{day}','{day}')->>'hands')::bigint=(SELECT count(*)FROM({raw})e)")
   yes(f"SELECT (ca_club_member_detail({args(day)})->'stats'->>'claimed_back')::numeric=(SELECT count(*)FROM({raw})e)")
   yes(f"SELECT (ca_club_member_detail({args(day)})->'stats'->>'mtt_winnings')::numeric=(SELECT count(*)*2 FROM({raw})e)")
   if day>='2026-10-12':
    yes(f"SELECT cash_fees=(SELECT count(*)*.23 FROM({raw})e) AND tournament_fees=(SELECT count(*)*.37 FROM({raw})e)FROM ca_club_member_chicago_fee_totals({c},'{day}','{day}',{u})")
   print('PASS',day,hours,'hours, actual RPC hands/transfers/tournament/fee bounds')
  # Standing shares remain per-rule/per-UTC-day rounded, restricted to the selected timestamps.
  q(f"INSERT INTO smarter_private.player_rake_share_rules VALUES('fixture',{c},{u},{other},5000,'2026-01-01Z',NULL);")
  yes(f"SELECT coalesce((SELECT cash_fees FROM ca_club_member_chicago_fee_totals({c},'2026-11-02','2026-11-02',{u})),0)+coalesce((SELECT cash_fees FROM ca_club_member_chicago_fee_totals({c},'2026-11-02','2026-11-02',{other})),0)=(SELECT count(*)*.23 FROM({expected('2026-11-02')})e)")
  q(f"INSERT INTO smarter_private.player_fee_redemptions VALUES({c},{u},'2026-11-03',100);")
  # Fixed UTC-midnight redemption belongs to the preceding Chicago date.
  yes(f"SELECT (SELECT cash_fees FROM ca_club_member_chicago_fee_totals({c},'2026-11-02','2026-11-02',{u}))=(SELECT count(*)*.23 FROM({expected('2026-11-02')})e)-(SELECT sum(round(n*.23*5000/100)) FROM(SELECT count(*) n FROM({expected('2026-11-02')})e GROUP BY (played_at AT TIME ZONE 'UTC')::date)x)/100-1")
  print('PASS standing shares conserve selected-window fees; fixed redemption timestamp retained')
  q(f"UPDATE club_members SET agent_id={other} WHERE user_id={u};")
  yes(f"SELECT (SELECT total_fees FROM ca_club_member_downline_in_range({c},{other},'2026-11-02','2026-11-02'))=(SELECT total_fees FROM ca_club_member_chicago_fee_totals({c},'2026-11-02','2026-11-02',{u}))")
  yes(f"SELECT (SELECT total_fees FROM ca_club_member_downline_in_range({c},{other},NULL,NULL))=(SELECT total_fees FROM ca_club_member_fee_totals({c},NULL,NULL,{u}))")
  print('PASS downline uses selected Chicago fee window and preserves Overall bulk result')
  # Overall identity, one-sided ranges, date inputs, and preserved access.
  yes(f"SELECT (SELECT sum(hands) FROM ca_member_record_chicago_facts({c},{u},NULL,NULL))=(SELECT count(*)FROM ca_hand_facts)")
  yes(f"SELECT (SELECT sum(hands) FROM ca_member_record_chicago_facts({c},{u},'2026-11-02',NULL))=(SELECT count(*)FROM ca_hand_facts WHERE played_at>='2026-11-02 06:00Z')")
  yes(f"SELECT (SELECT sum(hands) FROM ca_member_record_chicago_facts({c},{u},NULL,'2026-11-02'))=(SELECT count(*)FROM ca_hand_facts WHERE played_at<'2026-11-03 06:00Z')")
  yes(f"SET test.access='none'; SELECT ca_club_member_detail({args('2026-11-02')}) IS NULL AND NOT(ca_club_member_statistics({c},{u},NULL,'2026-11-02','2026-11-02')->>'authorized')::boolean")
  yes("SELECT NOT has_function_privilege('authenticated','ca_member_record_chicago_facts(uuid,uuid,date,date)','EXECUTE') AND NOT has_function_privilege('anon','ca_club_member_chicago_fee_totals(uuid,date,date,uuid)','EXECUTE')")
  print('PASS Overall, open bounds and access/internal helper grants preserved')
 finally:
  if started:run([pg/'pg_ctl','-D',data,'-m','immediate','-w','stop'])
  shutil.rmtree(w)
if __name__=='__main__':main()
