import subprocess, json
from pathlib import Path
root=Path(__file__).parent
cases=[("cli10-sync",["--timeout=10","-t","sync busy"]),("cli10-async",["--timeout=10","-t","async sleep"]),("cli10-override",["--timeout=10","-t","explicit override"]),("fractional",["--timeout=1.5","-t","async sleep"]),("config10",["-t","async sleep"]),("cli-over-config",["--timeout=100","-t","async sleep"])]
results=[]
for name,args in cases:
 r=subprocess.run(["bun","test","./probe.test.ts",*args],cwd=root,capture_output=True,text=True,timeout=10)
 results.append(dict(name=name,args=args,exit=r.returncode,output=r.stdout+r.stderr))
 print(name, "exit",r.returncode, (r.stdout+r.stderr)[-1300:],flush=True)
(root/"results.json").write_text(json.dumps(results,indent=2)+"\n")
