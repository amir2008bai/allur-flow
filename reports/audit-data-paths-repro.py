import json, os, subprocess, sys, tempfile
from pathlib import Path

os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT / 'backend')
with tempfile.TemporaryDirectory(prefix='allur-audit-', dir=ROOT/'reports') as tmp:
    assert Path(tmp).resolve().is_relative_to((ROOT/'reports').resolve())
    env = dict(os.environ, ALLUR_DB=str(Path(tmp)/'audit.sqlite'), ALLUR_STATE_DIR=tmp, ALLUR_WARMUP='0', PYTHONPATH=str(ROOT/'backend'))
    def run(code):
        out = subprocess.check_output([sys.executable, '-B', '-c', code], env=env, text=True, timeout=120)
        print(out, flush=True)
        return json.loads(out)
    validation = run('''
import json
from app import live
from app.db import connect
batch=live.Batch(events=[{'station':'qc','type':'good','value':3},{'station':'qc','type':'good','value':'oops'}])
try:
 live.post_events(batch)
 error=None
except Exception as e:
 error=type(e).__name__
s=live.status()
rows=connect().execute("SELECT COUNT(*) FROM events WHERE event_type LIKE 'live_%'").fetchone()[0]
print(json.dumps({'pydantic_accepted':True,'error':error,'memory_good':s['good'],'memory_events':s['events'],'db_rows':rows}))
''')
    if '--validation-only' in sys.argv:
        sys.exit(0)
    live = run('''
import json, time
from app import live
from app.sim.api import run_payload
from app.db import connect
a = run_payload('base',7)
reply = live.post_events(live.Batch(events=[
 {'station':'paint','type':'state','value':'down','ts':time.time()-7200},
 {'station':'qc','type':'good','value':1000},
 {'station':'paint','type':'defect'}]))
b = run_payload('base',7)
run_payload.cache_clear()
d = run_payload('base',7)
s = live.status()
print(json.dumps({'accepted':reply, 'live_good':s['good'], 'live_defects':s['defects'], 'paint':next(x for x in s['stations'] if x['id']=='paint')['state'], 'kpi_equal':a['kpi']==b['kpi']==d['kpi'], 'frames_equal':a['frames']==b['frames']==d['frames'], 'db_live_rows':connect().execute("SELECT COUNT(*) FROM events WHERE event_type LIKE 'live_%'").fetchone()[0]}))
''')
    cold_live = run('''
import json
from app.live import status
from app.db import connect
s=status()
print(json.dumps({'good':s['good'], 'events':s['events'], 'db_live_rows':connect().execute("SELECT COUNT(*) FROM events WHERE event_type LIKE 'live_%'").fetchone()[0]}))
''')
    activate = run('''
import json, runpy
from app import dataset
from app.learn import api
from app.sim.api import run_payload
from app.sim.params import BASE
make = runpy.run_path('tests/test_real_data.py')['make_xlsx']
s=dataset.activate('mes.xlsx',make(paint_defect=0.08))
api.calib_add(api.CalibIn(produced=100,defects=20,who='audit'))
for i in range(20): api.camera_event(api.CameraEvent(event_type='paint_defect' if i<5 else 'paint_ok',body_id=str(i)))
t=run_payload('base',7)
print(json.dumps({'is_test':s['is_test'], 'calibration':s['calibration'], 'params':{k:vars(v) for k,v in BASE.stations.items()}, 'learn_mean':api.calib_state()['current']['mean'], 'camera_seen':api.camera_state()['seen'], 'good':t['kpi']['good_out'],'version':t['twin']['version']}))
''')
    restart = run('''
import json
from app import dataset
from app.learn import api
from app.sim.api import run_payload
from app.sim.params import BASE
s=dataset.status()
t=run_payload('base',7)
print(json.dumps({'is_test':s['is_test'], 'calibration':s['calibration'], 'params':{k:vars(v) for k,v in BASE.stations.items()}, 'learn_mean':api.calib_state()['current']['mean'], 'camera_seen':api.camera_state()['seen'], 'good':t['kpi']['good_out'],'version':t['twin']['version']}))
''')
    result={'live':live,'cold_live':cold_live,'activate':activate,'restart':restart}
    print(json.dumps(result,ensure_ascii=True,indent=2))
