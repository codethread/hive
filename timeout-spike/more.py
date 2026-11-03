import subprocess,json
from pathlib import Path
p=Path(__file__).parent
cases=[("file-default",["./defaults.test.ts","-t","file default async"]),("file-default-vs-cli",["./defaults.test.ts","--timeout=100","-t","file default async"]),("file-override",["./defaults.test.ts","--timeout=10","-t","file default override"]),("fraction-test",["./fraction.test.ts"]),("slow-hooks",["./hooks.test.ts","--timeout=10"]),("native-block",["./sleep-sync.test.ts","--timeout=10"]),("parallel",["./probe.test.ts","--timeout=10","--parallel=6"])]
results=[]
for name,args in cases:
 r=subprocess.run(["bun","test",*args],cwd=p,capture_output=True,text=True,timeout=10)
 results.append(dict(name=name,args=args,exit=r.returncode,output=r.stdout+r.stderr))
 print(name,"exit",r.returncode,(r.stdout+r.stderr)[-1700:],flush=True)
(p/"more-results.json").write_text(json.dumps(results,indent=2)+"\n")
