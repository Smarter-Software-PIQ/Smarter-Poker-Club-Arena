#!/usr/bin/env python3
"""Read-only schedule document validation and snapshot impact preview.

Live catalog has the canonical {profiles, events} shape. Occurrences are an array
(or {occurrences: [...]}) with schedule_id, status, started_at and optional
registration_count/refund_chips. Supplied financial totals are reported, never
inferred from entry prices. This program never connects to production.
"""
import argparse
import copy
import hashlib
from datetime import datetime, timezone
import json
import math
import re
import uuid
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

GAMES = {'NLH': 'nlh', 'PLO4': 'plo4', 'PLO5': 'plo5', 'PLO6': 'plo6', 'PLO8': 'plo8'}
VARIANTS = {'freezeout', 'bounty', 'progressive_bounty', 'mystery_bounty', 'satellite'}
ELIGIBLE = {'ANNOUNCED', 'REGISTERING', 'SCHEDULED', 'PENDING'}
STARTED = {'RUNNING', 'BREAK', 'PAUSED', 'COMPLETED', 'FINISHED'}


def number(value, minimum=0):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= minimum


def validate(doc):
    errors = []
    def require(ok, path, message):
        if not ok:
            errors.append({'path': path, 'message': message})
    if not isinstance(doc, dict) or not isinstance(doc.get('events'), list) or not isinstance(doc.get('profiles'), dict):
        return [{'path': '/', 'message': 'Expected object with events array and profiles object'}]
    profiles = doc['profiles']
    for key, levels in profiles.items():
        path = '/profiles/' + key
        if not isinstance(levels, list) or not levels:
            require(False, path, 'Nonempty blind ladder required')
            continue
        previous = 0
        for index, level in enumerate(levels):
            p = f'{path}/{index}'
            if not isinstance(level, dict):
                require(False, p, 'Level must be an object')
                continue
            require(level.get('level') == index + 1, p + '/level', 'Levels must be consecutive from 1')
            sb, bb = level.get('smallBlind'), level.get('bigBlind')
            coherent = number(sb, 1) and number(bb, 1) and sb <= bb and bb >= previous
            require(coherent, p, 'Positive small blind <= nondecreasing big blind required')
            if number(bb, 1):
                previous = bb
            require(number(level.get('ante')), p + '/ante', 'Nonnegative ante required')
            require(number(level.get('durationMinutes'), 0.000001), p + '/durationMinutes', 'Positive level clock required')
    ids, names = set(), set()
    for event in doc['events']:
        if isinstance(event, dict):
            names.update(v for v in (event.get('name'), event.get('sourceName')) if isinstance(v, str))
    identities = set()
    natural_keys = set()
    for index, event in enumerate(doc['events']):
        path = f'/events/{index}'
        if not isinstance(event, dict):
            require(False, path, 'Event must be an object')
            continue
        identity = event.get('id')
        try:
            uuid.UUID(identity)
            valid_id = True
        except (ValueError, TypeError, AttributeError):
            valid_id = False
        require(valid_id and identity not in ids, path + '/id', 'Unique UUID required')
        if valid_id:
            ids.add(identity)
        days, times = event.get('days'), event.get('times')
        valid_days = isinstance(days, list) and bool(days) and all(type(d) is int and 0 <= d <= 6 for d in days)
        valid_times = isinstance(times, list) and bool(times) and all(isinstance(t, str) and re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', t) for t in times)
        require(valid_days and len(set(days)) == len(days), path + '/days', 'Unique weekdays 0..6 required')
        require(valid_times and len(set(times)) == len(times), path + '/times', 'Unique HH:MM local times required')
        if valid_days and valid_times:
            for day in days:
                for time in times:
                    key = (identity, day, time)
                    require(key not in identities, path, 'Duplicate occurrence identity')
                    identities.add(key)
                    natural_key = (str(event.get('name', '')).casefold(), day, time)
                    require(natural_key not in natural_keys, path, 'Duplicate tournament name/day/time across definitions')
                    natural_keys.add(natural_key)
        profile = event.get('blindProfile')
        require(isinstance(profile, str) and profile in profiles, path + '/blindProfile', 'Existing blind profile required')
        terms, config = event.get('terms'), event.get('config')
        if not isinstance(terms, dict) or not isinstance(config, dict):
            require(False, path, 'terms and config objects required')
            continue
        require(isinstance(event.get('name'), str) and bool(event['name'].strip()) and event['name'] == terms.get('name') == config.get('name'), path + '/name', 'Event, terms and config names must agree')
        producer_type = config.get('type')
        variant = terms.get('variant')
        if producer_type == 'fixed_board':
            # Fixed-board creation resolves its template before the maintained
            # Midway terms override; the resulting flags must still agree.
            effective_variant = ('mystery_bounty' if terms.get('is_mystery_bounty') else 'progressive_bounty' if terms.get('is_pko') else 'bounty' if terms.get('is_bounty') else 'freezeout')
            require(isinstance(config.get('fixedBoard'), str) and bool(config['fixedBoard']) and variant == effective_variant, path + '/config/type', 'Fixed-board reference and variant flags must agree')
        else:
            effective_variant = 'freezeout' if producer_type == 'rebuy' else producer_type
            require(variant == effective_variant, path + '/config/type', 'Producer type and terms variant must agree')
        game = terms.get('game_type')
        require(game in GAMES and config.get('gameVariant') == GAMES.get(game), path, 'Supported coherent game required')
        variant = terms.get('variant')
        require(variant in VARIANTS and terms.get('tournament_type') == 'MTT', path, 'Supported MTT variant required')
        for flag, expected in [('is_pko', variant == 'progressive_bounty'), ('is_mystery_bounty', variant == 'mystery_bounty')]:
            require(terms.get(flag) is expected, path + '/terms/' + flag, 'Variant flag mismatch')
        require(type(terms.get('starting_chips')) is int and terms['starting_chips'] > 0, path + '/terms/starting_chips', 'Positive starting stack required')
        late = terms.get('late_reg_levels')
        require(type(late) is int and late >= 0, path + '/terms/late_reg_levels', 'Nonnegative integer late registration level required')
        require(number(terms.get('late_reg_mins')), path + '/terms/late_reg_mins', 'Nonnegative registration clock required')
        for field in ('buy_in_amount', 'buy_in_fee', 'guaranteed_prize'):
            require(number(terms.get(field)), path + '/terms/' + field, 'Nonnegative amount required')
        require(type(terms.get('addon_break_minutes')) is int and terms['addon_break_minutes'] > 0, path + '/terms/addon_break_minutes', 'Positive add-on clock required even when disabled')
        if terms.get('add_on_available'):
            require(number(terms.get('addon_chips'), 1) and number(terms.get('addon_cost')), path, 'Enabled add-on needs chips and nonnegative cost')
        for term, config_key in [('starting_chips', 'startingStack'), ('guaranteed_prize', 'guaranteedPrize'), ('late_reg_levels', 'lateRegistrationLevels'), ('is_rebuy', 'isRebuy'), ('is_reentry', 'isReentry'), ('add_on_available', 'addOnAvailable')]:
            require(terms.get(term) == config.get(config_key), path + '/config/' + config_key, 'Configuration and terms must agree')
        if number(terms.get('buy_in_amount')) and number(terms.get('buy_in_fee')):
            require(config.get('buyIn') == terms['buy_in_amount'] + terms['buy_in_fee'], path + '/config/buyIn', 'Buy-in total must equal principal plus fee')
        require(event.get('timeZone', 'America/Chicago') == 'America/Chicago', path + '/timeZone', 'America/Chicago required')
        require(config.get('type') in {'fixed_board', 'rebuy', 'freezeout', 'bounty', 'progressive_bounty', 'mystery_bounty', 'satellite'}, path + '/config/type', 'Unsupported config type')
        bool_fields = ('is_bounty', 'is_pko', 'is_mystery_bounty', 'is_rebuy', 'is_reentry', 'add_on_available', 'free_buy', 'all_in_or_fold', 'is_pinned', 'big_blind_ante', 'synchronized_breaks', 'ban_chat', 'addon_from_start', 'accelerated_mtt', 'is_turbo')
        for field in bool_fields:
            require(type(terms.get(field)) is bool, path + '/terms/' + field, 'Boolean required')
        if isinstance(profile, str) and profile in profiles and isinstance(profiles[profile], list) and type(late) is int:
            require(late <= len(profiles[profile]), path + '/terms/late_reg_levels', 'Late registration exceeds ladder')
        if number(terms.get('buy_in_amount')) and number(terms.get('buy_in_fee')):
            total = terms['buy_in_amount'] + terms['buy_in_fee']
            require(terms['buy_in_fee'] <= total * 0.1 + 1e-9, path + '/terms/buy_in_fee', 'Fee exceeds 10 percent of total')
            require(not terms.get('free_buy') or total == 0, path + '/terms/free_buy', 'Free Buy must have zero entry total')
        seats = terms.get('table_size')
        require(type(seats) is int and seats > 0, path + '/terms/table_size', 'Positive coherent table size required')
        if game == 'PLO6':
            require(type(seats) is int and seats <= 7, path + '/terms/table_size', 'Game exceeds card capacity')
        target = config.get('satelliteTargetName')
        if variant == 'satellite' or target is not None:
            matches = [e for e in doc['events'] if isinstance(e, dict) and isinstance(target, str) and target and isinstance(e.get('name'), str) and (e['name'] == target or e['name'].startswith(target))]
            exact = [e for e in matches if e['name'] == target]
            matches = exact or matches
            require(variant == 'satellite' and len(matches) == 1 and matches[0].get('id') != identity and matches[0].get('terms', {}).get('variant') != 'satellite', path + '/config/satelliteTargetName', 'Satellite needs unique canonical non-feeder target, distinct from itself')
    return errors


def recursive_diff(before, after, path=''):
    """Every changed leaf, including added/removed object keys; arrays are ordered."""
    result = []
    if isinstance(before, dict) and isinstance(after, dict):
        for key in sorted(before.keys() | after.keys()):
            escaped = str(key).replace('~', '~0').replace('/', '~1')
            p = path + '/' + escaped
            if key not in before:
                result.append({'path': p, 'kind': 'added', 'after': after[key]})
            elif key not in after:
                result.append({'path': p, 'kind': 'removed', 'before': before[key]})
            else:
                result.extend(recursive_diff(before[key], after[key], p))
    elif (type(before) is not type(after) and not (number(before, -float('inf')) and number(after, -float('inf')))) or before != after:
        result.append({'path': path or '/', 'kind': 'changed', 'before': before, 'after': after})
    return result


def normalize_live(live, candidate):
    live = copy.deepcopy(live)
    live.setdefault('profiles', candidate.get('profiles', {}))
    for event in live.get('events', []):
        terms, config = event.get('terms'), event.get('config')
        if not isinstance(terms, dict) or not isinstance(config, dict):
            raise ValueError('Live event ' + str(event.get('id')) + ': terms and config objects required')
        ladder = terms.pop('blind_structure', None)
        if isinstance(ladder, str):
            ladder = json.loads(ladder)
        if ladder is None:
            ladder = config.get('blindStructure')
        if ladder is not None:
            profile = next((key for key, value in live['profiles'].items() if value == ladder), None)
            if profile is None:
                profile = 'LIVE_UNKNOWN_' + event['id']
                live['profiles'][profile] = ladder
            event['blindProfile'] = profile
        for key in ('blindStructure', 'midwayWeeklyTerms', 'levelMinutes'):
            config.pop(key, None)
    return live


def review(candidate, live, occurrences=None):
    errors = validate(candidate)
    if errors:
        return {'valid': False, 'validationErrors': errors, 'writesPerformed': False}
    if occurrences is None and isinstance(live, dict):
        occurrences = live.get('occurrences')
    try:
        live = normalize_live(live, candidate) if isinstance(live, dict) else live
    except (ValueError, TypeError, KeyError) as error:
        return {'valid': False, 'validationErrors': [{'path': '/live', 'message': str(error)}], 'writesPerformed': False}
    if not isinstance(live, dict) or not isinstance(live.get('events'), list) or not isinstance(live.get('profiles'), dict):
        return {'valid': False, 'validationErrors': errors + [{'path': '/live', 'message': 'Normalized live catalog required'}]}
    live_ids = [e.get('id') for e in live['events']]
    if any(not isinstance(identity, str) for identity in live_ids) or len(set(live_ids)) != len(live_ids):
        return {'valid': False, 'validationErrors': [{'path': '/live/events', 'message': 'Unique live schedule IDs required'}], 'writesPerformed': False}
    old = {e['id']: e for e in live['events']}
    new = {e['id']: e for e in candidate.get('events', []) if isinstance(e, dict) and isinstance(e.get('id'), str)}
    changes = []
    affected = set()
    for identity in sorted(old.keys() | new.keys()):
        kind = 'added' if identity not in old else 'removed' if identity not in new else 'changed'
        before = {k:v for k,v in old.get(identity, {}).items() if k not in ('sourceScheduleId', 'sourceName')}
        after = {k:v for k,v in new.get(identity, {}).items() if k not in ('sourceScheduleId', 'sourceName')}
        if before:
            before.setdefault('timeZone', 'America/Chicago')
        if after:
            after.setdefault('timeZone', 'America/Chicago')
        fields = recursive_diff(before, after)
        # A changed profile affects each referencing event even if its profile ID is unchanged.
        old_profile = live['profiles'].get(old.get(identity, {}).get('blindProfile'))
        new_profile = candidate.get('profiles', {}).get(new.get(identity, {}).get('blindProfile'))
        fields += recursive_diff(old_profile, new_profile, '/resolvedBlindStructure')
        if fields:
            affected.add(identity)
            changes.append({'scheduleId': identity, 'kind': kind, 'fields': fields})
    impacts = None
    if occurrences is not None:
        impacts = []
        for occurrence in occurrences:
            if occurrence.get('scheduleId', occurrence.get('schedule_id')) not in affected:
                continue
            status = occurrence.get('status', '').upper()
            if occurrence.get('startedAt', occurrence.get('started_at')) is not None or occurrence.get('finalized') is True or status in STARTED:
                decision = 'started_contract_preserved'
            elif status in ELIGIBLE and ('startedAt' in occurrence or 'started_at' in occurrence):
                decision = 'eligible_unstarted'
            elif status in {'CANCELLED', 'CANCELED'}:
                decision = 'already_cancelled'
            else:
                decision = 'unknown'
            preserved = decision == 'started_contract_preserved'
            impacts.append({'occurrenceId': occurrence.get('id'), 'scheduleId': occurrence.get('scheduleId', occurrence.get('schedule_id')), 'status': status, 'decision': decision, 'registrationCount': occurrence.get('registrations', occurrence.get('registration_count')), 'recordedOutstandingEntitlementChips': occurrence.get('refundChips', occurrence.get('refund_chips')), 'fundedByTickets': occurrence.get('fundedByTickets'), 'satelliteSeatEntries': occurrence.get('satelliteSeatEntries'), 'cancellationRefundStatus': 'preserved_contract' if preserved else occurrence.get('cancellationRefundStatus', 'requires_exact_authority'), 'finalRefundChips': occurrence.get('refundChips', occurrence.get('refund_chips')) if not preserved and occurrence.get('refundAuthorityVerified') is True else None, 'financialImpactKnown': not preserved and occurrence.get('refundAuthorityVerified') is True and occurrence.get('refundCoverageComplete') is True and occurrence.get('registrations', occurrence.get('registration_count')) is not None and occurrence.get('refundChips', occurrence.get('refund_chips')) is not None})
    return {'valid': not errors, 'validationErrors': errors, 'changes': changes, 'documentDiff': recursive_diff({k:v for k,v in live.items() if k in ('revision', 'profiles')}, {k:v for k,v in candidate.items() if k in ('revision', 'profiles')}), 'occurrenceImpacts': impacts, 'occurrenceSnapshotProvided': occurrences is not None, 'writesPerformed': False}


def candidate_from_workbook(path, base):
    """Read exported XLSX literals; hidden U is the immutable schedule identity.

    Changed H totals require explicit principal/fee values in the canonical candidate.
    J must agree with an existing profile in P; new blind profiles belong in JSON.
    """
    ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    relns = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
    with zipfile.ZipFile(path) as archive:
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            strings = [''.join(e.itertext()) for e in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('m:si', ns)]
        relationships = {r.attrib['Id']: r.attrib['Target'] for r in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        sheets = ET.fromstring(archive.read('xl/workbook.xml')).findall('m:sheets/m:sheet', ns)
        rows_by_id = {}
        blind_rows = []
        days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        for sheet in sheets:
            name = sheet.attrib['name']
            if name not in days and name != 'Blind structures':
                continue
            target = relationships[sheet.attrib[relns + 'id']]
            target = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            for row in ET.fromstring(archive.read(target)).findall('m:sheetData/m:row', ns):
                if int(row.attrib['r']) <= 5:
                    continue
                values = {}
                for cell in row.findall('m:c', ns):
                    col = re.sub(r'\d', '', cell.attrib['r'])
                    if cell.find('m:f', ns) is not None:
                        raise ValueError(f'{name}!{cell.attrib["r"]}: formulas are not editable schedule literals')
                    raw = cell.findtext('m:v', default='', namespaces=ns)
                    kind = cell.attrib.get('t')
                    if kind == 's':
                        value = strings[int(raw)]
                    elif kind == 'inlineStr':
                        value = ''.join(cell.find('m:is', ns).itertext())
                    elif kind in ('str', 'b', 'e'):
                        value = raw
                    else:
                        value = float(raw) if raw else ''
                        if isinstance(value, float) and value.is_integer():
                            value = int(value)
                    values[col] = value
                if name == 'Blind structures':
                    if any(v != '' for v in values.values()):
                        profile, level = values.get('A'), values.get('B')
                        if profile not in base['profiles'] or not number(level, 1) or int(level) != level or int(level) > len(base['profiles'][profile]):
                            raise ValueError('Changed or unknown blind profile; author the complete ladder in canonical JSON')
                        expected_level = base['profiles'][profile][int(level)-1]
                        expected_values = [profile, expected_level['level'], expected_level['smallBlind'], expected_level['bigBlind'], expected_level['ante'], expected_level['durationMinutes']]
                        if [values.get(col, '') for col in 'ABCDEF'] != expected_values:
                            raise ValueError('Changed blind ladder requires explicit canonical profiles source')
                        blind_rows.append((profile, int(level)))
                    continue
                if not values.get('C'):
                    continue
                if values.get('L') != 'Midway Union':
                    raise ValueError(f'{name} row {row.attrib["r"]}: L scope must be Midway Union')
                if values.get('O') not in (None, '') and values['O'] != values.get('D'):
                    raise ValueError(f'{name} row {row.attrib["r"]}: O configured guarantee must equal D guarantee')
                identity = values.get('U')
                if not identity:
                    raise ValueError(f'{name} row {row.attrib["r"]}: hidden U Schedule ID is required')
                if values.get('A') != name:
                    raise ValueError(f'{name} row {row.attrib["r"]}: day must match its tab')
                rows_by_id.setdefault(identity, []).append((days.index(name), values))
    expected_blinds = [(key, i+1) for key, levels in base['profiles'].items() for i in range(len(levels))]
    if sorted(blind_rows) != sorted(expected_blinds):
        raise ValueError('Missing or duplicate blind profile rows; author complete profiles in canonical JSON')
    candidate = copy.deepcopy(base)
    old = {e['id']: e for e in base['events']}
    unknown = set(rows_by_id) - old.keys()
    if unknown:
        raise ValueError('Unknown workbook Schedule IDs: ' + ', '.join(sorted(unknown)))
    candidate['events'] = []
    for identity, rows in rows_by_id.items():
        event = copy.deepcopy(old[identity])
        editable = ('C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'M', 'N', 'P')
        exemplar = rows[0][1]
        if any(any(v.get(c) != exemplar.get(c) for c in editable) for _, v in rows[1:]):
            raise ValueError(f'{identity}: inconsistent settings across weekday rows')
        t, c = event['terms'], event['config']
        event['name'] = t['name'] = c['name'] = exemplar['C']
        for col, term, config in [('D', 'guaranteed_prize', 'guaranteedPrize'), ('I', 'starting_chips', 'startingStack'), ('K', 'late_reg_levels', 'lateRegistrationLevels')]:
            t[term] = c[config] = exemplar[col]
            if col == 'K' and number(t[term]) and int(t[term]) == t[term]:
                t[term] = c[config] = int(t[term])
        total = exemplar['H']
        if total != t['buy_in_amount'] + t['buy_in_fee']:
            raise ValueError(f'{identity}: changed H buy-in requires explicit terms.buy_in_amount, terms.buy_in_fee and config.buyIn in canonical candidate')
        for col, term, config in [('F', 'is_rebuy', 'isRebuy'), ('G', 'add_on_available', 'addOnAvailable'), ('N', 'is_reentry', 'isReentry')]:
            if exemplar.get(col) not in ('Yes', 'No'):
                raise ValueError(f'{identity}: {col} must be Yes or No')
            t[term] = c[config] = exemplar[col] == 'Yes'
        game = exemplar.get('M')
        if game not in GAMES:
            raise ValueError(f'{identity}: unsupported game')
        t['game_type'], c['gameVariant'] = game, GAMES[game]
        profile = exemplar.get('P')
        if profile not in base['profiles']:
            raise ValueError(f'{identity}: unknown blind profile')
        first = base['profiles'][profile][0]
        expected = f"{first['durationMinutes']} min; starts {first['smallBlind']}/{first['bigBlind']}"
        if exemplar.get('J') != expected:
            raise ValueError(f'{identity}: Blind levels must agree with existing profile P')
        event['blindProfile'] = profile
        formats = {'Satellite': 'satellite', 'Fixed Bounty': 'bounty', 'PKO': 'progressive_bounty', 'Mystery Bounty': 'mystery_bounty', 'Freezeout': 'freezeout', 'Regular MTT': 'freezeout'}
        label = exemplar.get('E', '')
        free = label.startswith('Free Buy / ')
        label = label.removeprefix('Free Buy / ')
        if label == 'All-in-or-fold':
            variant = t['variant']
        elif label in formats:
            variant = formats[label]
        else:
            raise ValueError(f'{identity}: unsupported tournament type')
        if variant != t['variant'] or free != t['free_buy'] or (label == 'All-in-or-fold') != t['all_in_or_fold']:
            raise ValueError(f'{identity}: format conversion requires explicit canonical config.type and complete terms')
        t.update(variant=variant, free_buy=free, all_in_or_fold=label == 'All-in-or-fold', is_bounty=variant in ('bounty', 'progressive_bounty', 'mystery_bounty'), is_pko=variant == 'progressive_bounty', is_mystery_bounty=variant == 'mystery_bounty')
        occurrence_keys = set()
        for day, values in rows:
            if not number(values.get('B')) or not 0 <= values['B'] < 1:
                raise ValueError(f'{identity}: numeric Central start time required')
            minutes = round(values['B'] * 1440)
            if abs(values['B'] * 1440 - minutes) > 0.00001:
                raise ValueError(f'{identity}: start time must have minute precision')
            key = (day, f'{minutes // 60:02}:{minutes % 60:02}')
            if key in occurrence_keys:
                raise ValueError(f'{identity}: duplicate workbook occurrence')
            occurrence_keys.add(key)
        event['days'] = sorted({day for day, _ in occurrence_keys})
        event['times'] = sorted({time for _, time in occurrence_keys})
        if len(occurrence_keys) != len(event['days']) * len(event['times']):
            raise ValueError(f'{identity}: rows do not form supported days/times product')
        candidate['events'].append(event)
    return candidate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', required=True, type=Path)
    parser.add_argument('--live', required=True, type=Path)
    parser.add_argument('--occurrences', type=Path)
    parser.add_argument('--workbook', type=Path, help='Optional XLSX edits applied to --candidate base; requires hidden U IDs')
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--max-snapshot-age-minutes', type=float, default=15)
    args = parser.parse_args()
    try:
        candidate, live = (json.loads(path.read_text()) for path in (args.candidate, args.live))
        if args.workbook:
            candidate = candidate_from_workbook(args.workbook, candidate)
        occurrences = json.loads(args.occurrences.read_text()) if args.occurrences else None
        if isinstance(occurrences, dict):
            occurrences = occurrences['occurrences']
        if occurrences is not None and (not isinstance(occurrences, list) or not all(isinstance(o, dict) for o in occurrences)):
            raise ValueError('Occurrences must be an array of objects')
        result = review(candidate, live, occurrences)
        digest = lambda value: hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
        as_of = live.get('asOf') if isinstance(live, dict) else None
        if as_of is None:
            raise ValueError('Live snapshot asOf timestamp is required; obtain a fresh on-demand snapshot')
        fresh = None
        age = None
        if as_of is not None:
            captured = datetime.fromisoformat(as_of.replace('Z', '+00:00'))
            if captured.tzinfo is None or args.max_snapshot_age_minutes <= 0:
                raise ValueError('Snapshot asOf must include timezone; maximum age must be positive')
            age = (datetime.now(timezone.utc) - captured).total_seconds() / 60
            fresh = 0 <= age <= args.max_snapshot_age_minutes
        result['provenance'] = {'asOf': as_of, 'snapshotProvided': as_of is not None, 'liveSnapshotSHA256': digest({'live': live, 'occurrencesOverride': occurrences}), 'candidateSHA256': digest(candidate), 'snapshotAgeMinutes': age, 'snapshotFresh': fresh, 'maxSnapshotAgeMinutes': args.max_snapshot_age_minutes, 'requiresFreshReadBeforePublication': True, 'authorityToApply': False}
        if fresh is False:
            result['valid'] = False
            result.setdefault('validationErrors', []).append({'path': '/live/asOf', 'message': 'Snapshot is stale or future-dated; obtain a fresh on-demand snapshot'})
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile, ET.ParseError) as error:
        result = {'valid': False, 'validationErrors': [{'path': '/', 'message': str(error)}], 'writesPerformed': False}
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
    return 0 if result['valid'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
