#!/usr/bin/env python3
"""Pure history regression: no PostgreSQL or production connection."""
import importlib.util
import os
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('member_stats', Path(__file__).with_name('test-member-stats-chicago.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
with tempfile.TemporaryDirectory(prefix='member-history-', dir=os.environ.get('TMPDIR')) as temporary:
 directory = Path(temporary)
 baseline = '001.sql'
 (directory / baseline).write_text('SELECT 1;')
 (directory / '002.sql').write_text("""
 -- CREATE FUNCTION public.ca_club_member_detail() RETURNS text AS $$SELECT 'UTC'$$ LANGUAGE sql;
 SELECT 'CREATE FUNCTION public.ca_club_member_statistics()';
 CREATE FUNCTION public.unrelated() RETURNS text AS $other$ SELECT 'UTC' $other$ LANGUAGE sql;
 """)
 assert runner.latest_reporting_overlay(directory, baseline) == []
 regression = "CREATE OR REPLACE FUNCTION public.ca_club_member_detail() RETURNS text AS $utc$ SELECT 'UTC; still inside body' $utc$ LANGUAGE sql;"
 (directory / '003.sql').write_text(regression)
 overlay = runner.latest_reporting_overlay(directory, baseline)
 assert overlay == [('003.sql', regression)], overlay
 replacement = "CREATE OR REPLACE FUNCTION public.\"ca_club_member_detail\"() RETURNS text AS $$ SELECT 'Chicago' $$ LANGUAGE sql;"
 (directory / '004.sql').write_text(replacement)
 assert runner.latest_reporting_overlay(directory, baseline) == [('003.sql', regression), ('004.sql', replacement)]
 (directory / '005.sql').write_text('DROP FUNCTION public.ca_club_member_detail();')
 try:
  runner.latest_reporting_overlay(directory, baseline)
 except RuntimeError as error:
  assert 'fixture qualification' in str(error)
 else:
  raise AssertionError('a dropped reporting owner was ignored')
print('PASS latest reporting history and UTC regression selection')
