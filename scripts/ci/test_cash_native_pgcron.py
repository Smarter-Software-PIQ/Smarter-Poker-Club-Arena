import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('cash_native',Path(__file__).with_name('test-cash-failure-pgcron.py'))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NativeCashOracles(unittest.TestCase):
    def test_multistatement_set_feedback_is_not_terminal_even_after_backend_exit(self):
        # Captured run41344782383/runid2: libpq's first SET result was committed
        # before the scheduler consumed the failing SELECT, after backend exit.
        provisional={'runid':2,'status':'succeeded','has_error':False,'provisional_set':True,
                     'message_md5':'8c52684db8f49511e9b44471716bf164'}
        self.assertTrue(module.provisional_set_feedback(provisional))
        final=dict(provisional,status='failed',has_error=True,provisional_set=False,message_md5='2cd3fed246a55ea3e8005d091c48b486')
        self.assertFalse(module.provisional_set_feedback(final))
        module.validate_native_terminal(final,'failed','after-intake')

    def test_non_set_success_is_still_an_unexpected_failure_outcome(self):
        unexpected={'status':'succeeded','has_error':False,'provisional_set':False,'message_md5':'1dfff85bd1556bff3fbb9e8c46c2334b'}
        self.assertFalse(module.provisional_set_feedback(unexpected))
        with self.assertRaisesRegex(RuntimeError,'original scheduler status changed'):
            module.validate_native_terminal(unexpected,'failed','after-intake')
        module.validate_native_terminal(unexpected,'succeeded','successful-check')
        with self.assertRaisesRegex(RuntimeError,'lost actual checker error'):
            module.validate_native_terminal(dict(unexpected,status='failed'),'failed','after-intake')

    def test_pinned_command_has_only_the_known_set_then_select_results(self):
        self.assertTrue(module.COMMAND.startswith("SET statement_timeout = '600s'; SELECT "))
        self.assertEqual(module.COMMAND.count(';'),2)
        self.assertEqual(module.COMMAND.count('SET '),1)

    def test_current_checkout_matches_every_pinned_cash_input(self):
        # Run the real preflight before allocating PostgreSQL. This catches a
        # stale nested manifest when a directly connected qualifier changes.
        manifest = module.load_inputs()
        self.assertEqual(set(manifest['files']), set(module.FIXED_INPUTS))

    def test_exact_delivered_and_failed_outcomes_are_distinct(self):
        for state in ('delivered','intake_failed'):
            module.validate_outcome({'count':1,'state':state,'same_failure':True,'receipt_exact':True},state)

    def test_missing_wrong_or_foreign_receipts_cannot_pass(self):
        base={'count':1,'state':'delivered','same_failure':True,'receipt_exact':True}
        for key,value in [('count',0),('count',2),('state','intake_failed'),('same_failure',False),('receipt_exact',False),('receipt_exact',None)]:
            with self.subTest(key=key,value=value),self.assertRaises(RuntimeError):
                module.validate_outcome(dict(base,**{key:value}),'delivered')

    def test_cancellation_during_cleanup_cannot_become_success(self):
        receipt={'passed':True,'checksPassed':True,'cleanup':{'stopped':True}}
        self.assertTrue(module.qualifies(receipt,None))
        module.record_interruption(receipt,15,during_cleanup=True)
        self.assertFalse(receipt['passed'])
        self.assertFalse(module.qualifies(receipt,None))
        self.assertIn('signal 15',receipt['failure'])
        first=receipt['failure']
        module.record_interruption(receipt,2,during_cleanup=True)
        self.assertEqual(receipt['failure'],first)

    def test_work_cancellation_preserves_the_original_failure(self):
        receipt={'failure':'original SQL failure','checksPassed':True,'cleanup':{'stopped':True}}
        with self.assertRaisesRegex(RuntimeError,'signal 15'):
            module.record_interruption(receipt,15,during_cleanup=False)
        self.assertEqual(receipt['failure'],'original SQL failure')
        self.assertFalse(module.qualifies(receipt,None))

    def test_native_success_requires_actual_wait_and_completion(self):
        steps=['hold','scan_begin','scan','mutate_source','release','scan','invisible_before_commit','scan_commit',
            'assert_snapshot','durable_after_commit','restore_source','scan_begin_again','scan_again',
            'second_begin','second_scan','scan_commit_again','second_commit','assert_distinct_invocations']
        lines=['step '+name+': '+('<waiting ...>' if i==2 else '<... completed>' if i==5 else 'SELECT 1;') for i,name in enumerate(steps)]
        good='\n'.join(lines)
        module.validate_race_output(good,'')
        bads=[(good.replace('<waiting ...>',''),'') ,(good.replace('<... completed>',''),''),
            (good+'\nERROR: a statement failed',''),(good,'FATAL: connection lost'),
            (good.replace('step assert_distinct_invocations:','step wrong_assertion:'),'')]
        for stdout,stderr in bads:
            with self.subTest(stdout=stdout,stderr=stderr),self.assertRaises(RuntimeError):
                module.validate_race_output(stdout,stderr)


if __name__=='__main__':unittest.main()
