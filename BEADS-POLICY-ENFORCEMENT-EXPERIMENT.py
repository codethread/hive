"""Small native policy experiment; only a newly created disposable tracker is written."""
import json, os, subprocess, tempfile
from pathlib import Path
ROOT = Path(tempfile.mkdtemp(prefix="hive-policy-probe-"))
DB = ROOT/".beads/beads.db"
ENV = os.environ.copy()
for key in ["BEADS_DB","BEADS_DIR","BEADS_JSONL","BR_OUTPUT_FORMAT","TOON_DEFAULT_FORMAT"]:
    ENV.pop(key,None)
ENV["BEADS_DB"] = str(DB)
BASE = ["br","--db",str(DB),"--actor","amaranth-fat-bedbug","--no-auto-import","--no-auto-flush"]
results = {"root":str(ROOT),"cases":[]}
def call(name,args):
    p = subprocess.run(BASE+args,cwd=ROOT,env=ENV,text=True,capture_output=True,timeout=30)
    row={"case":name,"args":args,"exit":p.returncode,"stdout":p.stdout,"stderr":p.stderr}
    results["cases"].append(row)
    return json.loads(p.stdout) if p.returncode == 0 and p.stdout.strip() else None
call("init",["init","--prefix","pp","--json"])
POLICY = """allow_bypass: false
close_policy:
  require_close_reason:
    enabled: true
    min_length: 1
workflow:
  strict: true
  statuses: [draft, open, in_progress, in_review, blocked, deferred, closed, tombstone, pinned]
  transitions:
    initial: [draft]
    draft: [open]
    open: [in_progress]
    any: [closed]
  required_fields:
    "draft -> open": [acceptance_criteria_present]
    closed: [acceptance_criteria]
"""
policy_path=ROOT/".beads/policy.yaml"
policy_path.write_text(POLICY)
results["policy"]=POLICY
call("implicit-open-rejected",["create","Default status","--owner","ct","--json"])
work=call("draft-create",["create","Ordinary work","--status","draft","--owner","ct","--json"])["id"]
call("leave-draft-without-ac",["update",work,"--status","open","--json"])
call("unchecked-ac-can-leave-draft",["update",work,"--acceptance-criteria","- [ ] Check result","--status","open","--json"])
call("unchecked-ac-cannot-close",["close",work,"--reason","Verified outcome","--json"])
call("paragraph-ac",["update",work,"--acceptance-criteria","This is a non-checklist paragraph; no criteria were actually ticked.","--json"])
call("reason-required",["close",work,"--json"])
call("paragraph-passes-completion",["close",work,"--reason","Verified outcome","--json"])
system=call("system-draft-create",["create","System record","--status","draft","--labels","system","--deps",f"related:{work}","--description",'{"kind":"fixture"}',"--owner","ct","--json"])["id"]
call("system-no-label-exemption",["update",system,"--status","open","--json"])
call("response-closed-create-rejected",["create","Response record","--status","closed","--labels","response","--deps",f"replies-to:{work}","--owner","ct","--json"])
policy_path.write_text(POLICY + """  entry_routes:
    - {label: system, to: open}
    - {label: response, to: closed}
""")
results["entry_routes_added"]=[{"label":"system","to":"open"},{"label":"response","to":"closed"}]
sys2=call("system-entry-route",["create","System entry route","--status","open","--labels","system","--deps",f"related:{work}","--owner","ct","--json"])["id"]
call("system-entry-still-cannot-close",["close",sys2,"--reason","Finished system record","--json"])
call("response-entry-closed-without-ac-or-reason",["create","Response entry route","--status","closed","--labels","response","--deps",f"replies-to:{work}","--owner","ct","--json"])
Path(__file__).with_suffix(".json").write_text(json.dumps(results,indent=2))
for x in results["cases"]:
    print(f'{x["case"]}: exit {x["exit"]} ' + x["stderr"].strip().replace("\n"," ")[:140])
print("Evidence:",Path(__file__).with_suffix(".json"))
