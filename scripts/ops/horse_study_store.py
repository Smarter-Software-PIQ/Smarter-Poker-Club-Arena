"""Private searchable artifact. Never connects to production or issues policy."""
import json
import sqlite3


def initialize(connection):
    connection.executescript('''
      CREATE TABLE hands(hand_id TEXT PRIMARY KEY, domain TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE decisions(decision_id TEXT PRIMARY KEY, hand_id TEXT NOT NULL REFERENCES hands(hand_id),
        domain TEXT NOT NULL, street TEXT NOT NULL, action TEXT NOT NULL, origin TEXT,
        payload TEXT NOT NULL);
      CREATE TABLE candidates(decision_id TEXT NOT NULL REFERENCES decisions(decision_id), kind TEXT NOT NULL,
        PRIMARY KEY(decision_id,kind));
      CREATE INDEX decisions_domain_street ON decisions(domain,street,action);
      CREATE INDEX decisions_hand ON decisions(hand_id);
      CREATE INDEX candidates_kind ON candidates(kind,decision_id);
    ''')


def put_hand(connection, hand, domain):
    connection.execute('INSERT INTO hands VALUES (?,?,?,?)',
        (hand['handId'],domain,hand['status'],json.dumps(hand,separators=(',',':'))))


def put_decision(connection, decision):
    connection.execute('INSERT INTO decisions VALUES (?,?,?,?,?,?,?)',
        (decision['decisionId'],decision['handId'],decision['domain'],decision['street'],
         decision['action'],decision.get('origin'),json.dumps(decision,separators=(',',':'))))
    kinds={f['kind'] for f in decision.get('findings',[])}
    kinds.update(decision.get('review',{}).get('candidates',[]))
    connection.executemany('INSERT INTO candidates VALUES (?,?)',
        ((decision['decisionId'],kind) for kind in sorted(kinds)))


def hand_review(connection, hand_id):
    row=connection.execute('SELECT payload FROM hands WHERE hand_id=?',(hand_id,)).fetchone()
    if not row:raise ValueError('hand_not_in_artifact')
    result=json.loads(row[0])
    decisions=[json.loads(r[0]) for r in connection.execute(
        'SELECT payload FROM decisions WHERE hand_id=? ORDER BY decision_id',(hand_id,))]
    decisions.sort(key=lambda d:int(d['decisionId'].rsplit(':',1)[1]))
    result['decisions']=decisions
    return result


def candidates(connection, kind, limit=100, domain=None):
    if type(limit) is not int or not 1<=limit<=1000:raise ValueError('invalid_limit')
    if domain is not None and (not isinstance(domain,str) or len(domain.split('/'))!=3):
        raise ValueError('invalid_domain')
    return [json.loads(row[0]) for row in connection.execute(
        'SELECT d.payload FROM decisions d JOIN candidates c USING(decision_id) WHERE c.kind=? AND (? IS NULL OR d.domain=?) ORDER BY d.decision_id LIMIT ?',
        (kind,domain,domain,limit))]
