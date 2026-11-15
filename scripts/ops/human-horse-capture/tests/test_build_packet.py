import unittest, build_packet as b
D=b.DAY; A=100*D
def p(**k):
    d=dict(fam='holdem',trn=True,n=200,vpip=0.25,six=1,rate=0.3,last_at_ms=A-1000,n24=100,v24=0.25,r24=0.3,nold=100,vold=0.25,rold=0.3); d.update(k); return d
W=dict(changes=[],execution={'anchorActor':'h'},review={'status':'reconciled'},lastAggressor={'betToPotBefore':0.5})
class T(unittest.TestCase):
    def test_classes(self):
        self.assertEqual(b.classify(None,A),'unknown'); self.assertEqual(b.classify(p(n=10),A),'unknown')
        self.assertEqual(b.classify(p(last_at_ms=A-8*D),A),'stale'); self.assertEqual(b.classify(p(n=30,n24=10,nold=20),A),'thin')
        self.assertEqual(b.classify(p(vpip=0.15,v24=0.15,vold=0.15),A),'tight'); self.assertEqual(b.classify(p(vpip=0.25,six=0,v24=0.25,vold=0.25),A),'tight')
        self.assertEqual(b.classify(p(vpip=0.6,rate=0.6,v24=0.6,r24=0.6,vold=0.6,rold=0.6),A),'maniac_sustained')
        self.assertEqual(b.classify(p(vpip=0.6,rate=0.6,v24=0.6,r24=0.6,n24=100,nold=10,vold=0.6,rold=0.2),A),'maniac_selective')
        self.assertEqual(b.classify(p(v24=0.6,r24=0.6,vold=0.15),A),'changing'); self.assertEqual(b.classify(p(fam='omaha',vpip=0.7,rate=0.6,v24=0.7,r24=0.6,vold=0.7,rold=0.6),A),'ordinary')
    def test_limit_holdem_uses_holdem_thresholds(self):
        self.assertEqual(b.classify(p(fam='limit',vpip=0.25,v24=0.25,vold=0.25),A),'ordinary'); self.assertEqual(b.classify(p(fam='limit',vpip=0.15,v24=0.15,vold=0.15),A),'tight')
        self.assertEqual(b.classify(p(fam='hilo',vpip=0.30,v24=0.30,vold=0.30),A),'tight')
    def test_pre_repair_overfolder_not_counted(self):
        self.assertEqual(b.verdict('tight',dict(W,engineInput={'engineRead':{'overFolder':True}},_preRepairProfile=True)),'overfolder_pre_repair_bias_not_counted')
        self.assertEqual(b.verdict2('overfolder_pre_repair_bias_not_counted'),'baseline kept')
    def test_snapshot_verdict_is_unjudgeable(self):
        self.assertEqual(b.verdict2('unverified_prior_snapshot_not_at_hand'),'unjudgeable')
    def test_verdict2(self):
        self.assertEqual(b.verdict2('abstention_consistent'),'baseline kept'); self.assertEqual(b.verdict2('maniac_change_needs_replay'),'adjustment')
        self.assertEqual(b.verdict2('overfolder_no_pressure_question_for_owner'),'baseline kept'); self.assertEqual(b.verdict2('unjudgeable'),'unjudgeable')
    def test_future_observation_refused(self):
        with self.assertRaises(ValueError): b.classify(p(last_at_ms=A),A)
    def test_verdicts(self):
        self.assertEqual(b.verdict('unknown',W),'abstention_consistent'); self.assertEqual(b.verdict('unknown',dict(W,changes=[1])),'change_on_weak_evidence_needs_replay')
        E=lambda **k: dict(W,engineInput={'engineRead':k})
        self.assertEqual(b.verdict('tight',W),'tight_outside_overfolder_scope_owner_question'); self.assertEqual(b.verdict('tight',E(overFolder=True)),'overfolder_no_pressure_question_for_owner')
        self.assertEqual(b.verdict('tight',E(maniacRaiseWidth=0.4)),'conflicting_engine_reads_maniac_analysis_tight'); self.assertEqual(b.verdict('tight',E(error='x')),'unjudgeable')
        self.assertEqual(b.verdict('maniac_sustained',dict(E(maniacRaiseWidth=0.5),changes=[1])),'maniac_change_needs_replay'); self.assertEqual(b.verdict('maniac_sustained',E(read=None)),'maniac_not_read_by_engine_question_for_owner')
        self.assertEqual(b.verdict('ordinary',dict(W,lastAggressor={'betToPotBefore':1.2})),'abstention_consistent'); self.assertEqual(b.verdict('tight',dict(W,execution=None)),'unjudgeable')
    def test_tight_style_read_recognition(self):
        E=lambda **k: dict(W,engineInput={'engineRead':k})
        self.assertEqual(b.verdict('tight',E(read=None,style={'tightReRaiserRespect':True,'tightOpenerRespect':False})),'tight_style_read_no_change_needs_replay')
        self.assertEqual(b.verdict('tight',dict(E(read=True,style={'tightOpenerRespect':True}),changes=[1])),'tight_style_change_needs_replay')
        self.assertEqual(b.verdict('tight',E(read=True,style={'tightOpenerRespect':False,'tightReRaiserRespect':False})),'tight_outside_overfolder_scope_owner_question')
        self.assertEqual(b.verdict('tight',E(read=True,style=None)),'tight_outside_overfolder_scope_owner_question')
        self.assertEqual(b.verdict('tight',E(overFolder=True,style={'tightReRaiserRespect':True})),'overfolder_no_pressure_question_for_owner')
        self.assertEqual(b.verdict2('tight_style_read_no_change_needs_replay'),'baseline kept'); self.assertEqual(b.verdict2('tight_style_change_needs_replay'),'adjustment')
if __name__=='__main__': unittest.main()
