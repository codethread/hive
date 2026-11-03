"""Disposable, sequential CLI graph measurements. Never selects Hive's shared DB."""
import json, os, random, statistics, subprocess, tempfile, time
from pathlib import Path

ACTOR = 'amaranth-fat-bedbug'
OUT = Path(__file__).with_suffix('.json')
ROOT = Path(tempfile.mkdtemp(prefix='hive-graph-bench-'))
STAMP = '2026-10-24T18:00:00Z'
FIELDS = 'id,title,issue_type,status,priority,assignee,owner,updated_at,labels,dependency_count,dependent_count'
BASE_ENV = os.environ.copy()
for key in ['BEADS_DB', 'BEADS_DIR', 'BEADS_JSONL', 'BR_OUTPUT_FORMAT', 'BV_OUTPUT_FORMAT', 'TOON_DEFAULT_FORMAT']:
    BASE_ENV.pop(key, None)
BASE_ENV['BV_NO_CACHE'] = '1'

def ident(i): return f'gp-n{i:05d}'
def node(i):
    return dict(id=ident(i), title=f'Work record {i}', description='A small task or linked diary.',
        status='open', priority=2, issue_type='task', owner='ct', created_at=STAMP,
        created_by=ACTOR, updated_at=STAMP, source_repo='graph-benchmark', compaction_level=0,
        original_size=0, dependencies=[])
def link(rows, a, b, kind='related'):
    rows[a]['dependencies'].append(dict(issue_id=ident(a), depends_on_id=ident(b), type=kind,
        created_at=STAMP, created_by=ACTOR, metadata='{}', thread_id=''))
def fixtures():
    rows=[node(i) for i in range(12)]
    for a,b,k in [(1,0,'parent-child'),(2,0,'related'),(3,0,'replies-to'),(0,4,'related'),(5,3,'replies-to'),(6,0,'blocks'),(7,0,'related'),(8,0,'related'),(9,0,'related'),(10,0,'related')]: link(rows,a,b,k)
    rows[5].update(status='closed',closed_at=STAMP,close_reason='Response filed')
    rows[7].update(status='deferred'); rows[8].update(status='draft'); rows[9].update(labels=['system']); rows[10].update(status='tombstone',deleted_at=STAMP,deleted_by=ACTOR,delete_reason='Fixture')
    yield 'mixed-semantics',rows
    for size in [100,1000,5000]:
        rows=[node(i) for i in range(size)]
        for i in range(1,size): link(rows,i,0)
        yield f'star-{size}',rows
    rows=[node(i) for i in range(5000)]
    for i in range(1,11): link(rows,i,0)
    yield 'small-island-5000',rows
    rows=[node(i) for i in range(1000)]
    for i in range(1,1000): link(rows,i,0)
    for i,row in enumerate(rows):
        row['description']='Description evidence. '*1500
        row['notes']='Consolidated summary. '*200
        row['comments']=[dict(id=i*4+j+1,issue_id=ident(i),author=ACTOR,text='Diary event. '*45,created_at=STAMP) for j in range(4)]
    yield 'payload-star-1000',rows
    rows=[node(i) for i in range(1000)]
    for i in range(1,1000): link(rows,i,i-1)
    yield 'chain-1000',rows
    rows=[node(i) for i in range(121)]
    for i in range(40):
        base=i*3
        for a,b in [(base+1,base),(base+2,base),(base+3,base+1),(base+3,base+2)]: link(rows,a,b)
    yield 'diamond-121',rows
    rows=[node(i) for i in range(100)]
    for i in range(1,100):
        for j in range(i): link(rows,i,j)
    yield 'dense-100',rows
    rows=[node(i) for i in range(200)]
    for i in range(200): link(rows,(i+1)%200,i)
    yield 'cycle-200',rows

def prepare(name,rows):
    folder=ROOT/name; folder.mkdir(); db=folder/'.beads/beads.db'
    env={**BASE_ENV,'BEADS_DB':str(db)}
    base=['br','--db',str(db),'--actor',ACTOR,'--no-auto-import','--no-auto-flush']
    for args in [['init','--prefix','gp','--json']]:
        p=subprocess.run(base+args,cwd=folder,env=env,capture_output=True,text=True,timeout=60)
        if p.returncode: raise RuntimeError(p.stderr+p.stdout)
    jsonl=folder/'.beads/issues.jsonl'
    jsonl.write_text(''.join(json.dumps(row,separators=(',',':'))+'\n' for row in rows))
    for args in [['sync','--import-only','--json'],['sync','--flush-only','--json']]:
        p=subprocess.run(base+args,cwd=folder,env=env,capture_output=True,text=True,timeout=120)
        if p.returncode: raise RuntimeError(name+': '+p.stderr+p.stdout)
    return folder,db,jsonl,env,base

def shape(value):
    info={}
    if isinstance(value,list):
        info['rows']=len(value)
        if value and 'id' in value[0]: info['unique_ids']=len({v['id'] for v in value})
        if value and 'repeat' in value[0]:
            info['repeats']=sum(v['repeat'] for v in value); info['truncated']=sum(v['truncated'] for v in value)
            info['max_depth']=max(v['depth'] for v in value)
        if value and 'dependencies' in value[0]:
            info['comments']=sum(len(v.get('comments',[])) for v in value)
            info['relations']=sum(len(v.get('dependencies',[]))+len(v.get('dependents',[])) for v in value)
    elif isinstance(value,dict):
        if 'adjacency' in value:
            info.update(nodes=value['nodes'],edges=value['edges'],source_kind=value['source_kind'],authority=value.get('source_authority'))
        elif 'components' in value:
            info.update(nodes=value['total_nodes'],components=value['total_components'],edges=sum(len(v['edges']) for v in value['components']))
        elif 'nodes' in value: info.update(nodes=len(value['nodes']),edges=len(value['edges']))
        elif 'issues' in value: info.update(rows=len(value['issues']),keys=list(value))
    return info

results={'root':str(ROOT),'versions':{'br':'0.7.6 b77ae70','bv':'0.25.2'},'method':'3 fresh sequential processes per command; first run retained; fixture creation warms filesystem; no-auto-import/flush on br; BV_NO_CACHE=1; 12s per-read timeout; wall time excludes caller JSON decoding; setup excluded','cases':[]}
OUT.write_text(json.dumps(results,indent=2))
for name,rows in fixtures():
    folder,db,jsonl,env,br=prepare(name,rows)
    commands={
        'dep-list-both':br+['dep','list',ident(0),'--direction','both','--json'],
        'dep-tree-depth10':br+['dep','tree',ident(0),'--direction','both','--json'],
        'dep-tree-depth2000':br+['dep','tree',ident(0),'--direction','both','--max-depth','2000','--json'],
        'br-graph-root':br+['graph',ident(0),'--json'],
        'br-graph-all':br+['graph','--all','--json'],
        'show-root':br+['show',ident(0),'--json'],
        'show-batch100':br+['show',*[ident(i) for i in range(min(100,len(rows)))],'--json'],
        'list-summary500':br+['list','--all','--deferred','--exclude-label','system','--fields',FIELDS,'--limit','500',*[a for i in range(min(500,len(rows))) for a in ['--id',ident(i)]],'--json'],
        'bv-jsonl-full':['bv','--db',str(jsonl),'--robot-graph','--graph-format','json'],
        'bv-jsonl-depth1':['bv','--db',str(jsonl),'--robot-graph','--graph-root',ident(0),'--graph-depth','1','--graph-format','json'],
        'bv-sqlite-depth1':['bv','--db',str(db),'--robot-graph','--graph-root',ident(0),'--graph-depth','1','--graph-format','json'],
    }
    case={'name':name,'input_nodes':len(rows),'input_edges':sum(len(r['dependencies']) for r in rows),'jsonl_bytes':jsonl.stat().st_size,'samples':[]}
    for rep in range(3):
        keys=list(commands); random.Random(100+rep).shuffle(keys)
        for key in keys:
            before=time.perf_counter()
            try:
                p=subprocess.run(commands[key],cwd=folder,env=env,capture_output=True,timeout=12)
                ms=(time.perf_counter()-before)*1000
                record={'command':key,'rep':rep,'ms':round(ms,3),'exit':p.returncode,'bytes':len(p.stdout),'stderr':p.stderr.decode(errors='replace')[:300]}
                if p.returncode==0:
                    value=json.loads(p.stdout); record['shape']=shape(value)
                    if rep==0 and name=='mixed-semantics': (folder/(key+'.json')).write_bytes(p.stdout)
                else: record['error']=p.stdout.decode(errors='replace')[:500]
            except subprocess.TimeoutExpired:
                record={'command':key,'rep':rep,'ms':12000,'timeout':True}
            case['samples'].append(record)
    results['cases'].append(case); OUT.write_text(json.dumps(results,indent=2))
    print(json.dumps({'case':name,'nodes':len(rows),'edges':case['input_edges'],'jsonl_mb':round(case['jsonl_bytes']/1e6,2),'timeouts':sum(s.get('timeout',False) for s in case['samples']),'errors':sum(s.get('exit',0)!=0 for s in case['samples'])}),flush=True)
print(str(OUT),flush=True)
