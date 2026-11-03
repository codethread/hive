"""Bounded storage probe comparing comment history with latest-only JSON updates."""
import json, os, sqlite3, statistics, subprocess, tempfile, time
from pathlib import Path
ROOT=Path(tempfile.mkdtemp(prefix="hive-latest-value-probe-"))
OUT=Path(__file__).with_suffix(".json")
ENV=os.environ.copy()
for k in ["BEADS_DB","BEADS_DIR","BEADS_JSONL","BR_OUTPUT_FORMAT","TOON_DEFAULT_FORMAT"]:
    ENV.pop(k,None)
result={"root":str(ROOT),"method":"20 sequential updates per fixture; subprocess wall times include native auto-export and output capture; one fixture per mode/size, no contention or performance guarantee. Explicit disposable databases only. No CAS read/lock cycle measured.","cases":[]}
for size in [16384,262144]:
 for mode in ["comments","description"]:
    folder=ROOT/f"{size}-{mode}"; folder.mkdir()
    db=folder/".beads/beads.db"
    base=["br","--db",str(db),"--actor","amaranth-fat-bedbug","--no-auto-import"]
    env={**ENV,"BEADS_DB":str(db)}
    receipts=[]
    def call(args):
        start=time.perf_counter()
        p=subprocess.run(base+args,cwd=folder,env=env,text=True,capture_output=True,timeout=30)
        elapsed=(time.perf_counter()-start)*1000
        if p.returncode: raise RuntimeError(p.stdout+p.stderr)
        receipts.append({"operation":args[0],"ms":elapsed,"stdout_bytes":len(p.stdout.encode())})
        return json.loads(p.stdout),elapsed
    call(["init","--prefix","lv","--json"])
    document={"kind":"storage-probe","payload":"x"*size,"latest":None}
    body=folder/"payload.json";body.write_text(json.dumps(document,separators=(",",":")))
    created,_=call(["create","System storage probe","--owner","ct","--labels","system","--description-file",str(body),"--json"])
    bead=created["id"]
    latencies=[]
    for i in range(20):
        latest={"sample":i,"phase":"running","attemptNumber":1}
        if mode=="comments":
            _,ms=call(["comments","add",bead,"--message","Colony observation fixture: "+json.dumps(latest,separators=(",",":")),"--json"])
        else:
            document["latest"]=latest
            body.write_text(json.dumps(document,separators=(",",":")))
            _,ms=call(["update",bead,"--description-file",str(body),"--json"])
        latencies.append(ms)
    call(["sync","--flush-only","--json"])
    connection=sqlite3.connect(f"file:{db}?mode=ro",uri=True)
    events=connection.execute("SELECT COUNT(*), COALESCE(SUM(length(CAST(COALESCE(old_value,'') AS BLOB))+length(CAST(COALESCE(new_value,'') AS BLOB))+length(CAST(COALESCE(comment,'') AS BLOB))),0) FROM events").fetchone()
    counts=connection.execute("SELECT COUNT(*), COALESCE(SUM(length(CAST(text AS BLOB))),0) FROM comments").fetchone()
    connection.close()
    result["cases"].append({"mode":mode,"payload_bytes":size,"updates":20,"median_update_ms":statistics.median(latencies),"range_ms":[min(latencies),max(latencies)],"db_bytes":db.stat().st_size,"jsonl_bytes":(folder/".beads/issues.jsonl").stat().st_size,"events_count":events[0],"event_text_bytes":events[1],"comments_count":counts[0],"comment_text_bytes":counts[1],"receipts":receipts})
    OUT.write_text(json.dumps(result,indent=2))
    print(json.dumps({k:v for k,v in result["cases"][-1].items() if k!="receipts"}))
