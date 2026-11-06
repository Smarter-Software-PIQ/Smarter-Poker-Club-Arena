"""Build an actionable implementation manifest, never a runtime approval."""

OWNERS={
 'plo4':'server/src/engine/plo4/Plo4LivePolicy.ts',
 'plo5':'server/src/engine/omaha/OmahaVariantLivePolicy.ts',
 'plo6':'server/src/engine/omaha/OmahaVariantLivePolicy.ts',
 'plo8':'server/src/engine/omaha/OmahaVariantLivePolicy.ts',
 'flo8':'server/src/engine/HorseLogic.ts',
 'nlh':'server/src/engine/HorseLogic.ts',
 'pineapple':'server/src/engine/HorseLogic.ts',
 'short_deck':'server/src/engine/HorseLogic.ts',
}
GATES=['original_information_set_bound','independent_reference_qualified',
       'causal_source_reproduction','regression_passed','untouched_holdout_passed',
       'existing_domain_authority_issued','protected_merge','deployed_source_verified',
       'natural_selected_and_accepted_use_verified']


def build_playbook(summary):
    entries=[]
    for key,count in sorted(summary['strategicReviewCandidates'].items()):
        form,variant,speed,issue=key.split('/')
        domain='/'.join((form,variant,speed))
        entries.append({'id':key,'status':'requires_counterfactual_and_source_reproduction',
            'domain':{'format':form,'variant':variant,'speedFormat':speed},
            'candidateDecisions':count,'evidenceQuery':{'candidate':issue,'domain':domain},
            'sourceOwner':OWNERS[variant],
            'objective':'Compare legal action sizes using original public ranges and net utility; preserve acceptable mixed actions.',
            'requiredInputs':['original_cards_and_public_action_line','exact_ruleContext',
                'chronological_opponent_response_model','legal_action_economics']+
                (['historical_whole_field_stacks_payouts_and_bounties'] if form=='tournament' else []),
            'qualificationRoute':'existing_variant_authority_and_corrective_review_where_supported',
            'sourceFix':None,'regressionEvidence':None,'qualifiedArtifact':None,
            'deployment':None,'liveUseEvidence':None,
            'gates':{gate:'not_proved_by_this_report' for gate in GATES},
            'activationAllowed':False})
    return {'schemaVersion':1,'kind':'horse-study-implementation-manifest',
        'status':'research_candidates_not_runtime_policy',
        'scopeComplete':False,'strategicAnalysisComplete':False,'activationAllowed':False,
        'population':{'histories':summary['uniqueHistoryRows'],'includedHands':summary['counts'].get('included',0),
            'decisions':summary['counts']['decisions']},
        'entries':entries,
        'crossCuttingRequirements':{
            'ownerValueDirective':'Middle/top full houses and near nuts checked to in PLO require value-bet-default evaluation; facing a big bet compare calling before escalating. Separate bottom full, stronger boats/quads, multi-board and tournament utility exceptions. No blanket hand-category profitability claim.',
            'memory':'Prior public observations only; no private-card pooling or coordinated actions; exact domain and uncertainty retained.',
            'lightning':'Require captured Lightning rules/version and public seat history; do not infer rules from speed alone.',
            'bbAnte':'Preserve actual dead investment, ante payer, pot odds and stack geometry; no blanket aggression multiplier.',
            'bubble':'Prize utility requires historical field/payout evidence; stage labels alone do not supply ICM.',
            'riverBluff':'Measure eligible opportunities, proposal, acceptance and outcomes separately; compare size-specific fold/call/raise responses.',
            'activation':'Use existing source-owned qualification and selection; this manifest is not accepted as an approval or runtime policy.'}}
