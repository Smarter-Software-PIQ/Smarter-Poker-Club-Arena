import copy
import unittest
from horse_river_conditional import price_checked_to_river


def request():
    return {'context': {'mode':'cash','street':'river','structure':'pot_limit','boardCount':1,'playersInHand':2,'dealtCount':2,'closingAction':True,'toCallUnits':0,'rakeUnits':0,'feesUnits':0,'anteUnits':0,'deadUnits':0,'sidePots':False,'bombPot':False,'allInOrFold':False},
            'variant':'plo4','hero':['Qc','Qs','Ac','Kd'], 'board':['Qh','Qd','2c','3s','9h'],
            'potUnits':100,'heroStackUnits':200,'opponentStackUnits':200,'minimumBetUnits':2,'betSizesUnits':[50],
            'range':[{'cards':['9c','9d','5s','6s'],'weight':1,'responses':{'50':{'fold':0,'call':1,'raise':0}}}]}


class ConditionalRiverTests(unittest.TestCase):
    def test_value_and_fold_limits_for_each_high_variant(self):
        for variant, extra in [('plo4',[]),('plo5',['7c']),('plo6',['7c','8d'])]:
            q=request();q['variant']=variant;q['hero']+=extra
            q['range'][0]['cards']+=['Tc','Jd'][:len(extra)]
            r=price_checked_to_river(q)
            self.assertEqual(r['checkThroughEvUnits']['exact'],'100')
            self.assertEqual(r['bets'][0]['evUnits']['exact'],'150')
            self.assertEqual(r['bets'][0]['minusCheckUnits']['exact'],'50')
            self.assertFalse(r['activationAllowed']);self.assertFalse(r['gtoVerified'])
            q['range'][0]['responses']['50']={'fold':1,'call':0,'raise':0}
            self.assertEqual(price_checked_to_river(q)['bets'][0]['minusCheckUnits']['exact'],'0')

    def test_losing_hand_bluff_and_call_losses(self):
        q=request();q['hero'],q['range'][0]['cards']=q['range'][0]['cards'],q['hero']
        r=price_checked_to_river(q);self.assertEqual(r['checkThroughEvUnits']['exact'],'0')
        self.assertEqual(r['bets'][0]['evUnits']['exact'],'-50')
        for fold, expected in [(0.2,'-20'),(0.4,'10')]:
            q['range'][0]['responses']['50']={'fold':fold,'call':1-fold,'raise':0}
            self.assertEqual(price_checked_to_river(q)['bets'][0]['evUnits']['exact'],expected)

    def test_weighted_range_check_value_and_response_sensitivity(self):
        q=request();q['hero']=['9c','9d','5s','6s']
        q['range']=[{'cards':['Qc','Qs','Ac','Kd'],'weight':3,'responses':{'50':{'fold':0,'call':1,'raise':0}}},
                    {'cards':['2h','2s','7c','8d'],'weight':1,'responses':{'50':{'fold':0,'call':1,'raise':0}}}]
        r=price_checked_to_river(q)
        self.assertEqual(r['checkThroughEvUnits']['exact'],'25')
        self.assertEqual(r['bets'][0]['evUnits']['exact'],'0')
        self.assertEqual(r['bets'][0]['minusCheckUnits']['exact'],'-25')

    def test_short_call_returns_uncalled_excess(self):
        q=request();q['opponentStackUnits']=20
        self.assertEqual(price_checked_to_river(q)['bets'][0]['evUnits']['exact'],'120')

    def test_tied_showdown_and_odd_chip_refusal(self):
        q=request();q['hero']=['Ac','Kd','Jc','Tc'];q['board']=['2c','3d','4h','8s','9c'];q['range'][0]['cards']=['As','Kh','Js','Th']
        r=price_checked_to_river(q);self.assertEqual(r['bets'][0]['evUnits']['exact'],'50')
        q['potUnits']=101
        with self.assertRaisesRegex(ValueError,'odd_chip'):price_checked_to_river(q)

    def test_unsupported_contexts_and_missing_assertion(self):
        for key,value in [('mode','tournament'),('closingAction',False),('boardCount',2),('playersInHand',3),('rakeUnits',1),('feesUnits',1),('anteUnits',1),('deadUnits',1),('sidePots',True)]:
            q=request();q['context'][key]=value
            with self.assertRaisesRegex(ValueError,'unsupported_context'):price_checked_to_river(q)
        q=request();del q['context']['closingAction']
        with self.assertRaises(ValueError):price_checked_to_river(q)
        q=request();q['variant']='plo8'
        with self.assertRaisesRegex(ValueError,'unsupported_variant'):price_checked_to_river(q)

    def test_raise_or_invalid_response_refused(self):
        for response in [{'fold':0,'call':0.5,'raise':0.5},{'fold':0,'call':1},{'fold':0.2,'call':0.9,'raise':0},{'fold':float('nan'),'call':1,'raise':0}]:
            q=request();q['range'][0]['responses']['50']=response
            with self.assertRaises(ValueError):price_checked_to_river(q)

    def test_menu_and_card_integrity(self):
        for bet in [101,0,1,True]:
            q=request();q['betSizesUnits']=[bet]
            with self.assertRaises(ValueError):price_checked_to_river(q)
        q=request();q['range'][0]['cards'][0]='Qc'
        with self.assertRaisesRegex(ValueError,'duplicate_card'):price_checked_to_river(q)
        q=request();q['range'].append(copy.deepcopy(q['range'][0]))
        with self.assertRaisesRegex(ValueError,'duplicate_range'):price_checked_to_river(q)

    def test_multiple_size_response_and_input_binding(self):
        q=request();q['betSizesUnits']=[50,100]
        with self.assertRaisesRegex(ValueError,'size_specific'):price_checked_to_river(q)
        q['range'][0]['responses']['100']={'fold':0.5,'call':0.5,'raise':0}
        r=price_checked_to_river(q);self.assertEqual([x['evUnits']['exact'] for x in r['bets']],['150','150'])
        self.assertEqual(r,price_checked_to_river(copy.deepcopy(q)))
        q['range'][0]['responses']['100']={'fold':1,'call':0,'raise':0}
        self.assertNotEqual(r['inputSha256'],price_checked_to_river(q)['inputSha256'])

class PrivateCliTests(unittest.TestCase):
    def test_private_json_cli_and_refusals(self):
        import json
        import os
        from pathlib import Path
        import subprocess
        import sys
        import tempfile
        # Keep all temporary test files on the caller's authorized filesystem.
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            folder=Path(directory);source=folder/'request.json';output=folder/'result.json'
            source.write_text(json.dumps(request()));source.chmod(0o600)
            command=[sys.executable,str(Path(__file__).with_name('horse_river_conditional.py')),
                     '--input',str(source),'--output',str(output)]
            result=subprocess.run(command,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            saved=output.read_bytes();parsed=json.loads(saved)
            self.assertEqual(parsed['bets'][0]['evUnits']['exact'],'150')
            self.assertFalse(parsed['activationAllowed'])
            self.assertEqual(output.stat().st_mode & 0o777,0o600)
            self.assertNotEqual(subprocess.run(command,capture_output=True).returncode,0)
            self.assertEqual(output.read_bytes(),saved)
            output.unlink();source.chmod(0o644)
            self.assertNotEqual(subprocess.run(command,capture_output=True).returncode,0)
            self.assertFalse(output.exists())
            source.chmod(0o600);folder.chmod(0o755)
            self.assertNotEqual(subprocess.run(command,capture_output=True).returncode,0)
            self.assertFalse(output.exists());folder.chmod(0o700)
            q=request();q['range'][0]['responses']['50']={'fold':0,'call':0.5,'raise':0.5}
            source.write_text(json.dumps(q))
            self.assertNotEqual(subprocess.run(command,capture_output=True).returncode,0)
            self.assertFalse(output.exists())


if __name__=='__main__':unittest.main()
