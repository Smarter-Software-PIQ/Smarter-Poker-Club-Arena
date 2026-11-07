"""Synthetic renderer and write-boundary guards; no solver, labels or M2 seed."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('input_draft',Path(__file__).with_name('assemble-public215-input-draft.py'))
draft=importlib.util.module_from_spec(spec);spec.loader.exec_module(draft)
NS='12345678-1234-4234-8234-123456789abc'

class DraftGuardTests(unittest.TestCase):
    def source(self, board='AsKdQc2s3h', node='r:0:c:c:2s:b250:b750:3h'):
        return {'scenario_id':'old','flop_board':board[:6],'purpose':'harvest',
                'conditional_history':{'model':'authored_range_preserving_response','target_node':node},
                'tree_lines':[[0,0,250,750]],'icm_model_id':'same-full-table',
                'targets':[{'target_id':'old.t','machine_id':'M1','board':board,'node':node,'expected_children':['c','f']} ]}

    def test_chronological_tokens_and_conditional_history(self):
        source=self.source();before=copy.deepcopy(source)
        result=draft.remap_scenario(source,'JhTs9c4d5s',NS,3)
        self.assertEqual(result['flop_board'],'JhTs9c')
        self.assertEqual(result['targets'][0]['node'],'r:0:c:c:4d:b250:b750:5s')
        self.assertEqual(result['conditional_history']['target_node'],result['targets'][0]['node'])
        self.assertEqual(result['targets'][0]['board'],'JhTs9c4d5s')
        self.assertEqual(result['targets'][0]['machine_id'],'M2')
        self.assertEqual(result['targets'][0]['expected_children'],['c','f'])
        self.assertEqual(result['tree_lines'],before['tree_lines'])
        self.assertEqual(result['icm_model_id'],before['icm_model_id'])
        self.assertEqual(source,before)
        self.assertEqual(result['scenario_id'],'r7f.m2.'+NS.replace('-','')+'.00003')

    def test_flop_has_no_native_community_tokens(self):
        s=self.source('AsKdQc','r:0:b250:b750')
        result=draft.remap_scenario(s,'JhTs9c',NS,0)
        self.assertEqual(result['targets'][0]['node'],'r:0:b250:b750')
        self.assertEqual(result['flop_board'],'JhTs9c')

    def test_turn_maps_only_runout(self):
        result=draft.remap_scenario(self.source('AsKdQc2s','r:0:c:c:2s:c'),'JhTs9c4d',NS,0)
        self.assertEqual(result['targets'][0]['node'],'r:0:c:c:4d:c')

    def test_wrong_chronology_or_street_refused(self):
        for s,b in [(self.source(node='r:0:c:c:3h:c:2s'),'JhTs9c4d5s'),(self.source(),'JhTs9c4d')]:
            with self.assertRaises(ValueError):draft.remap_scenario(s,b,NS,0)

    def test_illegal_duplicate_board_refused(self):
        for board in ['JhJh9c4d5s','XhTs9c4d5s','JhTs']:
            with self.assertRaises(ValueError):draft.remap_scenario(self.source(),board,NS,0)

    def test_exclusive_safe_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);draft.new_file(root,'inputs/a.json',b'{}')
            with self.assertRaises(FileExistsError):draft.new_file(root,'inputs/a.json',b'changed')
            self.assertEqual((root/'inputs/a.json').read_bytes(),b'{}')
            for name in ['../escape','/absolute','.env','a/.env.local']:
                with self.assertRaises(ValueError):draft.new_file(root,name,b'x')

    def test_input_hash_and_duplicate_keys_refuse(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory).resolve()/'public.json';p.write_bytes(b'{"x":1,"x":2}')
            with self.assertRaises(ValueError):draft.checked({'path':str(p),'sha256':'0'*64})
            with self.assertRaises(ValueError):draft.parsed({'path':str(p),'sha256':draft.sha(p.read_bytes())})

    def request(self, **changes):
        config={k:'x' for k in draft.REQUEST};config.update(format=draft.V1,pipeline_commit=draft.PRODUCER,source_namespace=draft.R7_NAMESPACE)
        config.update(changes);return config

    def fresh(self, **pin_changes):
        pins={'original_manifest_sha256':'1'*64,'source_partition_sha256':'2'*64,'m2_selection_sha256':'3'*64,
              'contexts':100,'m1_per_context':57,'m2_candidates':2000,'scenario_id_prefix':'r8f','draft_name':'public215-r8'}
        pins.update(pin_changes)
        return self.request(format=draft.V2,pipeline_commit='a'*40,source_namespace=NS,pins=pins)

    def test_r7_request_keeps_every_r7_pin(self):
        producer,pins=draft.request_pins(self.request())
        self.assertEqual(producer,'291a8e5658b6a706066b39fba6c75a714f578695')
        self.assertEqual(pins,{'original_manifest_sha256':'3ce35b5cfa4297575ff37c9583091056cd52bfde832afc861741829f291f1269',
            'source_partition_sha256':'8440d9613fe3013b82f8a1d76150499fbbcb4bf87ee9af0bf4bc8a63430d5427',
            'm2_selection_sha256':'973a54525509685a3533e984f9a147087fd16e9620e6a4c2ba77d315728f3797',
            'contexts':107,'m1_per_context':57,'m2_candidates':2147,'scenario_id_prefix':'r7f','draft_name':'public215-r7'})
        for bad in [self.request(pipeline_commit='a'*40),{**self.request(),'pins':{}},self.request(format='public_hist215_official_input_draft_request_v0')]:
            with self.assertRaises(ValueError):draft.request_pins(bad)

    def test_v2_request_takes_every_pin_from_its_own_config(self):
        producer,pins=draft.request_pins(self.fresh())
        self.assertEqual(producer,'a'*40);self.assertEqual(pins['contexts']*pins['m1_per_context'],5700)
        self.assertEqual(set(pins),set(draft.R7_PINS))
        broken=self.fresh();del broken['pins']['m2_candidates']
        cases=[broken,self.fresh(contexts=0),self.fresh(contexts=True),self.fresh(original_manifest_sha256='0'*64),
               self.fresh(scenario_id_prefix='r8'),self.fresh(draft_name='../r8'),{**self.fresh(),'pipeline_commit':'A'*40},
               {**self.fresh(),'extra':1},{**self.fresh(),'format':draft.V1}]
        for bad in cases:
            with self.assertRaises(ValueError):draft.request_pins(bad)

    def test_v2_never_reuses_the_r7_public_domain(self):
        for bad in [self.fresh(source_partition_sha256=draft.PARTITION_SHA),self.fresh(m2_selection_sha256=draft.SELECTION_SHA),
                    self.fresh(scenario_id_prefix='r7f'),self.fresh(draft_name='public215-r7'),{**self.fresh(),'source_namespace':draft.R7_NAMESPACE}]:
            with self.assertRaises(ValueError):draft.request_pins(bad)

    def test_fresh_prefix_names_new_holdout_scenarios(self):
        result=draft.remap_scenario(self.source(),'JhTs9c4d5s',NS,3,'r8f')
        self.assertEqual(result['scenario_id'],'r8f.m2.'+NS.replace('-','')+'.00003')
        self.assertEqual(result['targets'][0]['target_id'],result['scenario_id']+'.target')

if __name__=='__main__':unittest.main()
