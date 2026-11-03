import subprocess,json
from pathlib import Path
p=Path(__file__).parent
cases=[("config-explicit",["--config=./bunfig.toml","test","./probe.test.ts","-t","async sleep"]),("preload-default",["--config=./preload-config.toml","test","./probe.test.ts","-t","async sleep"]),("preload-override",["--config=./preload-config.toml","test","./probe.test.ts","-t","explicit override"]),("separate-hook-body",["test","./setup.test.ts","--timeout=40"])]
results=[]
for name,args in cases:
 r=subprocess.run(["bun",*args],cwd=p,capture_output=True,text=True,timeout=10)
 results.append(dict(name=name,args=args,exit=r.returncode,output=r.stdout+r.stderr))
 print(name,"exit",r.returncode,(r.stdout+r.stderr)[-1300:],flush=True)
(p/"extra-results.json").write_text(json.dumps(results,indent=2)+"\n")
