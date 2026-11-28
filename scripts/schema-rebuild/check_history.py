#!/usr/bin/env python3
"""Fingerprint immutable history; never execute historical financial SQL."""
import argparse,hashlib,json,sys
from pathlib import Path
def check(root,repo,inventory,forward):
 if forward:raise ValueError('A captured baseline does not admit forward migrations')
 records=inventory['repositories'][repo]['files']
 expected={record['path']:record['sha256'] for record in records}
 if len(expected)!=len(records):raise ValueError('Duplicate migration identity')
 actual={str(path.relative_to(root)):hashlib.sha256(path.read_bytes()).hexdigest() for path in (root/'supabase/migrations').rglob('*.sql')}
 missing=sorted(set(expected)-set(actual));changed=sorted(p for p in expected.keys()&actual.keys() if expected[p]!=actual[p]);new=sorted(set(actual)-set(expected));unadmitted=new;stale=[]
 return {'missing':missing,'changed':changed,'unadmittedNew':unadmitted,'staleForwardEntries':stale}
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--checkout',required=True);ap.add_argument('--repo',choices=['hub','arena'],required=True);ap.add_argument('--inventory',required=True);ap.add_argument('--forward',required=True);a=ap.parse_args();result=check(Path(a.checkout),a.repo,json.loads(Path(a.inventory).read_text()),json.loads(Path(a.forward).read_text()).get(a.repo,[]));print(json.dumps(result));return int(any(result.values()))
if __name__=='__main__':sys.exit(main())
