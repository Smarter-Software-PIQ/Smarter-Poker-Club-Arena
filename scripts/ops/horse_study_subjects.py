"""Explicit private research identities; never inferred from display names."""
import json
from pathlib import Path
import uuid


def read_subjects(path):
    if path is None:
        raise ValueError('private_subject_config_required')
    value = json.loads(Path(path).read_text())
    excluded = value.get('excludedSubjectIds')
    if not isinstance(excluded, list) or len(excluded) != len(set(excluded)):
        raise ValueError('unique_explicit_exclusions_required')
    comparison = value.get('comparisonSubjectId')
    for item in [*excluded, *([comparison] if comparison is not None else [])]:
        if not isinstance(item, str) or str(uuid.UUID(item)) != item:
            raise ValueError('canonical_subject_uuid_required')
    if comparison in excluded:
        raise ValueError('comparison_subject_is_excluded')
    return value


def validate_frozen_cohort(manifest, subjects):
    if manifest.get('cutoffUtc') != '2026-11-10T21:30:00+00:00':
        raise ValueError('unsupported_frozen_cutoff')
    if (set(manifest.get('excludedSubjectIds', [])) != set(subjects['excludedSubjectIds'])
            or len(subjects['excludedSubjectIds']) != 2 or not subjects.get('comparisonSubjectId')):
        raise ValueError('frozen_subject_selection_mismatch')
    corpus = manifest.get('unifiedDatabase', {})
    if corpus.get('sha256') != 'b785370d0f53fb263aa0627c3c74d91e0690805a364f4554435a089227317768':
        raise ValueError('unsupported_frozen_corpus_digest')
    if (corpus.get('totalHands'), corpus.get('includedHands'), corpus.get('totalDecisions')) != (49310, 41151, 349970):
        raise ValueError('unsupported_frozen_corpus')
