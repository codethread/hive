import json, os, subprocess, time
from pathlib import Path
BASE=Path(__file__).parent
report=json.loads((BASE/'BEADS-GRAPH-EXPERIMENT.json').read_text()); root=Path(report['root'])
env=os.environ.copy()
for key in ['BEADS_DB','BEADS_DIR','BEADS_JSONL','BR_OUTPUT_FORMAT','BV_OUTPUT_FORMAT','TOON_DEFAULT_FORMAT']: env.pop(key,None)
env['BV_NO_CACHE']='1'
results=[]
for name,source,kind in [('blocking-chain-1000','chain-1000','blocks'),('blocking-dense-100','dense-100','blocks')]:
 folder=root/name; folder.mkdir(); db=folder/'.beads/beads.db'; scope_env={**env,'BEADS_DB':str(db)}
 br=['br','--db',str(db),'--actor','amaranth-fat-bedbug','--no-auto-import','--no-auto-flush']
 def run(args):
  p=subprocess.run(br+args,cwd=folder,env=scope_env,capture_output=True,text=True,timeout=120)
  if p.returncode: raise RuntimeError(p.stdout+p.stderr)
 run(['init','--prefix','gp','--json'])
 rows=[json.loads(l) for l in (root/source/'.beads/issues.jsonl').read_text().splitlines()]
 for row in rows:
  for edge in row.get('dependencies',[]): edge['type']=kind
 jsonl=folder/'.beads/issues.jsonl'; jsonl.write_text(''.join(json.dumps(v)+'\n' for v in rows))
 run(['sync','--import-only','--json']); run(['sync','--flush-only','--json'])
 commands={'br-graph-root':br+['graph','gp-n00000','--json'],'br-graph-all':br+['graph','--all','--json'],'bv-jsonl-full':['bv','--db',str(jsonl),'--robot-graph'],'bv-jsonl-depth1':['bv','--db',str(jsonl),'--robot-graph','--graph-root','gp-n00000','--graph-depth','1']}
 for rep in range(3):
  for cmd,args in commands.items():
   start=time.perf_counter()
   try:
    p=subprocess.run(args,cwd=folder,env=scope_env,capture_output=True,timeout=12); ms=(time.perf_counter()-start)*1000
    data=json.loads(p.stdout)
    if 'adjacency' in data: counts={'nodes':data['nodes'],'edges':data['edges']}
    elif 'components' in data: counts={'nodes':data['total_nodes'],'edges':sum(len(c['edges']) for c in data['components'])}
    else: counts={'nodes':len(data['nodes']),'edges':len(data['edges'])}
    results.append({'case':name,'command':cmd,'rep':rep,'ms':ms,'bytes':len(p.stdout),'exit':p.returncode,**counts})
   except subprocess.TimeoutExpired: results.append({'case':name,'command':cmd,'rep':rep,'timeout':True})
 print(name,flush=True)
(BASE/'BEADS-GRAPH-SUPPLEMENT.json').write_text(json.dumps(results,indent=2))
