from pathlib import Path
import re
import json
import html

OUT=Path(__file__).resolve().parent.parent/'prototypes'
VENDOR=Path(__file__).resolve().parent.parent/'vendor'
source=(OUT/'work-palettes.html').read_text()
bees=json.loads(re.search(r'const bees=(.*?);\n',source).group(1))
tasks=json.loads(re.search(r'const tasks=(.*?);\n',source).group(1))
for t in tasks: t['comments']=[]
projects=[dict(id='hive',name='hive',state='awake',root='/demo/hive',db='/demo/hive/.beads/beads.db',bees=bees,tasks=tasks),
 dict(id='agents',name='agents',state='awake',root='/demo/agents',db='/demo/agents/.beads/beads.db',bees=[
 dict(id='maple',name='maple-calm-fox',kind='worker',harness='Pi',model='GPT-5',state='running',age='19m',attempt=1,spawn='ag-spawn-101',requester='ct',historical=False,tasks=['ag-demo-11','ag-demo-12']),
 dict(id='sable',name='sable-quiet-wren',kind='reviewer',harness='Claude',model='Sonnet',state='running',age='8m',attempt=1,spawn='ag-spawn-102',requester='maple-calm-fox',historical=False,tasks=['ag-demo-13']),
 dict(id='birch',name='birch-bright-otter',kind='worker',harness='Pi',model='GPT-5',state='starting',age='1m',attempt=1,spawn='ag-spawn-103',requester='ct',historical=False,tasks=['ag-demo-14','ag-demo-15'])],tasks=[
 dict(id='ag-demo-11',title='Capture hook session provenance',status='in_progress',priority=1,type='feature',labels=['plugin:harness','harness:pi'],description='Record the session context passed to the existing hook.',checks=[['Record an isolated session fixture',True],['Preserve attribution on session resume',False]],depends=[],comments=[]),
 dict(id='ag-demo-12',title='Document the hook payload',status='open',priority=2,type='task',labels=['plugin:harness','area:docs'],description='Describe the recorded fields and their source.',checks=[['Document which fields can be absent',False]],depends=[],comments=[]),
 dict(id='ag-demo-13',title='Review session-resume attribution',status='in_progress',priority=1,type='task',labels=['plugin:harness'],description='Review the implementation and record findings on the delivery task.',checks=[['Inspect resume and parent-session behavior',True],['Record actionable findings',False]],depends=[],comments=[]),
 dict(id='ag-demo-14',title='Tighten browser skill instructions',status='open',priority=2,type='task',labels=['plugin:browser','area:docs'],description='Keep the browser skill concise and executable.',checks=[['Check commands against the installed CLI',False]],depends=[],comments=[]),
 dict(id='ag-demo-15',title='Clarify browser permission scope',status='closed',priority=2,type='task',labels=['plugin:browser'],description='Record permission boundaries for browser interactions.',checks=[['Document the permission boundary',True]],depends=[],comments=[])])]

# Retain exactly the two selected themes.
source=re.sub(r':root\[data-palette="(?:graphite|midnight|aubergine)"\]\{[^}]*\}', '',source)
source=source.replace("const paletteIds = ['moss','graphite','midnight','aubergine','paper'];", "const paletteIds = ['moss','paper'];")
source=source.replace('<title>Colony / Work / Palette study</title>','<title>Colony / Work / Native filters</title>')
CSS=r'''
.colony-select{color:var(--ink);font-size:12px;font-weight:550;background:var(--raised);border:1px solid var(--line);padding:4px 8px;border-radius:4px;min-width:132px;max-width:240px}.colony-state{font-size:9px;color:var(--muted);display:inline-flex;align-items:center;gap:5px}.colony-state:before{content:"";width:4px;height:4px;border-radius:50%;background:var(--green)}.theme-control{display:flex;border:1px solid var(--line);border-radius:4px;overflow:hidden}.theme-control button{background:var(--surface);color:var(--muted);font-size:9px;padding:4px 8px}.theme-control button[aria-pressed="true"]{color:var(--accent);background:var(--tint)}.toolbar #search{width:220px}.labels-button[aria-expanded="true"],.labels-button.active{color:var(--accent);border-color:var(--accent);background:var(--tint)}.filters{padding:13px 17px;border-bottom:1px solid var(--line);background:var(--surface)}.filter-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.rule-group{margin:0;padding:0;border:0;min-width:0}.rule-group legend{font-size:10px;font-weight:550;color:var(--ink);margin-bottom:9px;display:flex;align-items:center;gap:9px}.rule-group legend code{font:9px ui-monospace,monospace;color:var(--dim);background:none;padding:0}.rule-items{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;min-height:25px}.rule-items:empty:before{content:attr(data-empty);font-size:10px;color:var(--dim);padding-top:4px}.rule-chip{border:1px solid var(--line);border-radius:4px;color:var(--ink);background:var(--raised);font-size:10px;display:inline-flex;align-items:center;gap:7px;padding:3px 6px}.rule-chip button{background:none;padding:0 2px;color:var(--muted);font-size:12px}.rule-chip.exclusion{background:var(--amberbg);border-color:var(--amberline);color:var(--amber)}.rule-group select{background:var(--bg);color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:5px 8px;font-size:10px;max-width:100%;width:100%}.filter-bottom{margin-top:12px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;font-size:9px;color:var(--dim)}.filters .reset{padding:0}.active-rules{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:7px 17px;border-bottom:1px solid var(--line);font-size:9px;background:var(--footer);color:var(--muted)}.active-rules code{font-size:9px;padding:2px 4px;background:var(--raised);border-radius:3px;color:var(--ink)}.active-rules .group{display:inline-flex;gap:5px;align-items:center}.active-rules .operator{color:var(--dim)}.native-query{margin:0;background:var(--surface);border:0;border-bottom:1px solid var(--line);border-radius:0;padding:10px 17px}.native-query h2{font-size:10px;color:var(--muted);font-weight:500;margin:0}.native-query pre{font:10px/1.8 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:10px}.query-context{font-size:9px;color:var(--dim);display:flex;gap:14px;flex-wrap:wrap}.query-source{font:9px/1.7 ui-monospace,monospace;color:var(--muted);overflow-wrap:anywhere}.query-tab{font-size:9px;color:var(--dim);margin-top:12px}.no-match-message{padding:0 17px 12px;color:var(--amber);font-size:10px;background:var(--surface);border-bottom:1px solid var(--line)}.label-origin{font-size:9px;color:var(--dim)}.reset:disabled{opacity:.4}.top .row{gap:8px}.query-error{color:var(--amber)}.body-layout{height:655px}.tag[data-tone="harness"],.tag[data-tone="browser"],.tag[data-tone="pi"]{--tag-tone:var(--blue)}.tag[data-tone="docs"]{--tag-tone:var(--violet)}
@media(max-width:700px){.filter-grid{grid-template-columns:1fr;gap:12px}.colony-select{min-width:105px}.colony-state{display:none}.top .product{display:none}.toolbar #search{width:100%}}
'''
source=source.replace('</head>','<style>'+CSS+'</style></head>')
start=source.index('<header class="top">')
end=source.index('<div id="body-layout"',start)
header='''<header class="top"><div class="row"><span class="product">colony</span><span class="divider">/</span><label class="sr-only" for="colony">Select colony</label><select id="colony" class="colony-select"><option value="hive">hive</option><option value="agents">agents</option></select><span id="colony-state" class="colony-state">Awake</span><span class="divider">/</span><h1>Work</h1></div><div class="row"><div class="theme-control" aria-label="Theme"><button data-theme="moss" aria-pressed="true">Moss</button><button data-theme="paper" aria-pressed="false">Paper</button></div><span class="sample">SAMPLE</span><time class="snapshot">14:32:00</time></div></header><section class="toolbar" aria-label="Work filters"><div class="segments"><button data-view="board" aria-pressed="true">Board</button><button data-view="map" aria-pressed="false">Work map</button></div><label class="sr-only" for="search">Search native bead text</label><input type="search" id="search" placeholder="Search bead text…"><button class="button labels-button" id="labels-toggle" aria-expanded="true" aria-controls="label-filters">Labels</button><button id="scope" class="button" aria-pressed="false" title="Toggle the selected bee’s ancestry and descendants">All work</button><label class="toggle"><input type="checkbox" id="completed">Closed beads</label><button class="button" id="query-toggle" aria-expanded="false" aria-controls="query-panel">Native query</button><button id="clear" class="reset" hidden>Clear filters</button><button id="details" class="button" hidden>Bead context</button><output id="results" class="results" aria-live="polite"></output></section><section class="filters" id="label-filters" aria-label="Native label filters"><div class="filter-grid"><fieldset class="rule-group"><legend>All of <code>--label</code></legend><div class="rule-items" id="all-rules" data-empty="Every selected label is required"></div><label class="sr-only" for="add-all">Add required label</label><select id="add-all" data-rule="all"></select></fieldset><fieldset class="rule-group"><legend>Any of <code>--label-any</code></legend><div class="rule-items" id="any-rules" data-empty="At least one selected label is required"></div><label class="sr-only" for="add-any">Add alternative label</label><select id="add-any" data-rule="any"></select></fieldset><fieldset class="rule-group"><legend>Exclude <code>--exclude-label</code></legend><div class="rule-items" id="none-rules" data-empty="Any selected label hides the bead"></div><label class="sr-only" for="add-none">Add excluded label</label><select id="add-none" data-rule="none"></select></fieldset></div><div class="filter-bottom"><span>Exact, case-sensitive labels · groups combine with AND · system/spawn metadata omitted</span><span><span id="label-origin" class="label-origin"></span> &nbsp; <button class="reset" id="clear-labels">Clear labels</button></span></div></section><div class="active-rules" id="active-rules" hidden></div><section class="native-query" id="query-panel" hidden aria-label="Native query mapping"><div class="row between"><h2>Native query · selected tracker only</h2><span class="label-origin">Preview, not executed</span></div><pre id="native-command"></pre><div class="query-context"><span id="query-context"></span></div><div class="query-tab">Label discovery · counts span the whole tracker, including closed / system beads</div><div class="query-source" id="discovery-command"></div></section><p class="no-match-message" id="filter-warning" hidden></p>'''
source=source[:start]+header+source[end:]
match=re.search(r'<script>\s*const bees=.*?</script>',source,re.S)
assert match,'main work script not found'
script_start=match.start();script_end=match.end()
js=match.group(0)[len('<script>'):-len('</script>')]
replacement='const colonies='+json.dumps(projects)+';\nlet currentColony=colonies[0];\nlet bees=currentColony.bees;\nlet tasks=currentColony.tasks;\n'
js=re.sub(r'const bees=.*?;\nconst tasks=.*?;\n', lambda _:replacement,js,count=1)
js=js.replace("const area=document.querySelector('#area');","const labelRules={all:new Set(),any:new Set(),none:new Set()};\nconst colonyStates=new Map();")
# Match actual br search fields; GUI-only bee/name and label search are not mixed into native search.
old="function visible(){const scope=chainOnly?family():null;return tasks.filter(t=>{const b=beeFor(t.id);return !b.historical&&(completed.checked||t.status!=='closed')&&(!scope||scope.has(b.id))&&(area.value==='all'||t.labels.includes(area.value))&&[t.id,t.title,...t.labels,b.name,b.kind].join(' ').toLowerCase().includes(search.value.trim().toLowerCase());});}"
new="""function scopeTasks(){const branch=chainOnly?family():null;return tasks.filter(t=>{const b=beeFor(t.id);return !b.historical&&!t.labels.includes('system')&&(completed.checked||t.status!=='closed')&&(!branch||branch.has(b.id));});}
function matchesLabels(t){return [...labelRules.all].every(l=>t.labels.includes(l))&&(!labelRules.any.size||[...labelRules.any].some(l=>t.labels.includes(l)))&&![...labelRules.none].some(l=>t.labels.includes(l));}
function visible(){const q=search.value.trim().toLowerCase();return scopeTasks().filter(t=>matchesLabels(t)&&[t.id,t.title,t.description,...t.comments].join(' ').toLowerCase().includes(q));}"""
assert old in js
js=js.replace(old,new)
js=js.replace("search.value===''&&area.value==='all'&&!chainOnly", "search.value===''&&!ruleCount()&&!chainOnly")
js=js.replace("if(list.length){drawInspector();}","refreshFilters();if(list.length){drawInspector();}")
js=js.replace("function clearFilters(){search.value='';area.value='all';chainOnly=false;render();}","function clearFilters(){search.value='';for(const set of Object.values(labelRules))set.clear();chainOnly=false;render();}")
js=js.replace("search.addEventListener('input',render);area.addEventListener('change',render);", "search.addEventListener('input',render);")
js=js.replace("const labelButton=event.target.closest('[data-label]');if(labelButton){area.value=labelButton.dataset.label;render();return;}","const labelButton=event.target.closest('[data-label]');if(labelButton){labelRules.all.add(labelButton.dataset.label);document.querySelector('#label-filters').hidden=false;document.querySelector('#labels-toggle').setAttribute('aria-expanded','true');render();return;}")
# Let excluded labels be cleared even when no matches; an empty branch can be restored.
js=js.replace("document.querySelector('#scope').disabled=!list.length;", "document.querySelector('#scope').disabled=!list.length&&!chainOnly;")
# Stable chain anchor prevents a filtered auto-selection silently changing the scope.
js=js.replace("let chainOnly=false;","let chainOnly=false;\nlet chainAnchor=null;")
js=js.replace("function family(){const b=beeFor(selected);", "function family(){const b=beeFor(chainAnchor||selected);")
js=js.replace("chainOnly=false;render();}","chainOnly=false;chainAnchor=null;render();}")
js=js.replace("chainOnly=!chainOnly;render();", "chainOnly=!chainOnly;chainAnchor=chainOnly?selected:null;render();")
js=js.replace("chainOnly=true;render();setView('map');", "chainOnly=true;chainAnchor=selected;render();setView('map');")

EXTRA=r'''
function ruleCount(){return Object.values(labelRules).reduce((n,set)=>n+set.size,0);}
const hiddenLabel=l=>l==='system'||l==='bee'||l.startsWith('agent:')||l.startsWith('bee-outcome:')||l.startsWith('bee-resolution:');
function labelInventory(){return [...new Set(tasks.flatMap(t=>t.labels))].filter(l=>!hiddenLabel(l)).sort();}
function quote(value){return JSON.stringify(value);}
function nativeQuery(){
 const ids=[...new Set(bees.filter(b=>!b.historical).flatMap(b=>b.tasks))];
 let args=search.value.trim()?'br search '+quote(search.value.trim()):'br list';
 for(const id of ids)args+=' --id '+quote(id);
 for(const [group,flag] of [['all','--label'],['any','--label-any'],['none','--exclude-label']])for(const l of labelRules[group])args+=' '+flag+' '+quote(l);
 args+=' --exclude-label "system"';
 if(completed.checked)args+=' --all';
 args+=' --limit 0 --db '+quote(currentColony.db)+' --json';
 document.querySelector('#native-command').textContent=args;
 document.querySelector('#query-context').textContent=chainOnly?'Then restrict to the selected requester chain in the GUI.':'IDs are the linked task beads from this colony’s active request inventory.';
 document.querySelector('#discovery-command').textContent='br label list-all --db '+quote(currentColony.db)+' --json';
}
function refreshFilters(){
 const inventory=labelInventory();const base=scopeTasks();
 for(const group of ['all','any','none']){
   document.querySelector('#'+group+'-rules').innerHTML=[...labelRules[group]].map(l=>`<span class="rule-chip ${group==='none'?'exclusion':''}">${esc(l)}<button data-remove-rule="${group}" data-value="${esc(l)}" aria-label="Remove ${esc(l)} from ${group}">×</button></span>`).join('');
   document.querySelector('#add-'+group).innerHTML='<option value="">+ Add label…</option>'+inventory.filter(l=>!labelRules[group].has(l)).map(l=>`<option value="${esc(l)}">${esc(l)} · ${base.filter(t=>t.labels.includes(l)).length} in scope</option>`).join('');
 }
 document.querySelector('#label-origin').textContent=inventory.length+' labels in '+currentColony.name;
 document.querySelector('#clear-labels').disabled=ruleCount()===0;
 const button=document.querySelector('#labels-toggle');button.textContent='Labels'+(ruleCount()?' · '+ruleCount():'');button.classList.toggle('active',ruleCount()>0);
 const summary=document.querySelector('#active-rules');summary.hidden=!ruleCount();
 summary.innerHTML=['all','any','none'].filter(g=>labelRules[g].size).map(g=>`<span class="group">${g==='all'?'All':g==='any'?'Any':'Exclude'} ${[...labelRules[g]].map(l=>`<code>${esc(l)}</code>`).join('<span class="operator">'+(g==='all'?'AND':'OR')+'</span>')}</span>`).join('<span class="operator">AND</span>');
 const contradictions=[...labelRules.all].filter(l=>labelRules.none.has(l));const warning=document.querySelector('#filter-warning');warning.hidden=!contradictions.length;warning.textContent=contradictions.length?'No bead can match: '+contradictions.join(', ')+' is both required and excluded.':'';
 nativeQuery();
}
for(const select of document.querySelectorAll('[data-rule]'))select.addEventListener('change',()=>{if(select.value){labelRules[select.dataset.rule].add(select.value);render();}});
document.addEventListener('click',event=>{
 const remove=event.target.closest('[data-remove-rule]');if(remove){labelRules[remove.dataset.removeRule].delete(remove.dataset.value);render();}
 const theme=event.target.closest('[data-theme]');if(theme){applyPalette(theme.dataset.theme);document.querySelectorAll('[data-theme]').forEach(b=>b.setAttribute('aria-pressed',String(b===theme)));}
});
document.querySelector('#clear-labels').addEventListener('click',()=>{for(const set of Object.values(labelRules))set.clear();render();});
document.querySelector('#labels-toggle').addEventListener('click',()=>{const panel=document.querySelector('#label-filters');panel.hidden=!panel.hidden;document.querySelector('#labels-toggle').setAttribute('aria-expanded',String(!panel.hidden));});
document.querySelector('#query-toggle').addEventListener('click',()=>{const panel=document.querySelector('#query-panel');panel.hidden=!panel.hidden;document.querySelector('#query-toggle').setAttribute('aria-expanded',String(!panel.hidden));});
function rememberColony(){colonyStates.set(currentColony.id,{selected,search:search.value,completed:completed.checked,chainOnly,chainAnchor,labels:Object.fromEntries(Object.entries(labelRules).map(([k,v])=>[k,[...v]]))});}
function switchColony(id){
 rememberColony();const next=colonies.find(p=>p.id===id);if(!next)throw new Error('Unknown colony '+id);
 if(cy){cy.destroy();cy=null;}overlayById.clear();document.querySelector('#overlays').innerHTML='';document.querySelector('#paths').innerHTML='';
 currentColony=next;bees=next.bees;tasks=next.tasks;
 const saved=colonyStates.get(id);
 selected=saved?saved.selected:tasks.find(t=>t.status==='in_progress').id;
 search.value=saved?saved.search:'';completed.checked=saved?saved.completed:false;chainOnly=saved?saved.chainOnly:false;chainAnchor=saved?saved.chainAnchor:null;
 for(const group of ['all','any','none']){labelRules[group].clear();if(saved)for(const value of saved.labels[group])labelRules[group].add(value);}
 document.querySelector('#colony-state').textContent=next.state==='awake'?'Awake':'Asleep';
 document.querySelector('#colony').title=next.root+' · '+next.db;
 render();
}
document.querySelector('#colony').addEventListener('change',event=>switchColony(event.target.value));
window.nativeFilters={labelRules,switchColony};
'''
# Declare functions/listeners before the initial render, preserving the existing public mock API.
js=js.replace("render();window.workBoard=",EXTRA+"\nrender();window.workBoard=")
source=source[:script_start]+'<script>'+js+'</script>'+source[script_end:]
(OUT/'work-native-filters.html').write_text(source)
body='''<p><strong>Moss and Paper are locked in.</strong> The colony switcher now scopes the entire working view to one project: beads, bees, requester chains, label vocabulary and native-query preview. Each project keeps its own filter state while you switch.</p><p>The label panel mirrors installed <code>br 0.7.4</code>: <strong>All of</strong> is repeated <code>--label</code>; <strong>Any of</strong> is repeated <code>--label-any</code>; <strong>Exclude</strong> is repeated <code>--exclude-label</code>. The groups combine with AND. Click a card label to add it to All of, or choose labels in any group. Selection counts say <em>in scope</em>, not whole-tracker totals.</p>'''
body+=f'<iframe title="Single-colony work board with native label filters" sandbox="allow-scripts" srcdoc="{html.escape(source,quote=True)}" style="display:block;width:calc(100vw - 40px);height:1100px;margin:20px calc(50% - 50vw + 20px);border:1px solid #7e8576;border-radius:8px;background:#111715"></iframe>'
body+='''<p><strong>Try:</strong> hive → All of <code>area:shared</code>, Any of <code>area:colony</code> and <code>evidence:architecture</code>, Exclude <code>evidence:architecture</code>. That leaves <code>demo-41</code>. Switch to agents: it starts unfiltered and offers its own labels. Switch back: hive’s rules return. There is no All projects view.</p><details><summary>Verified native semantics and integration boundaries</summary><ul><li>Repeated required labels intersect; any-of labels form a union; any excluded label hides the bead. Labels are exact and case-sensitive. No prefix, wildcard or comma-list expansion on these query flags.</li><li><code>br label list-all --json</code> returns label/count objects for the selected tracker. Those counts include closed and system beads; the GUI must not present them as current-board counts.</li><li><code>br search</code> searches bead title, description, ID and comments. The search field follows that boundary—not bee names or labels.</li><li>The query preview selects the active requests’ task IDs with repeated <code>--id</code>, applies labels and excludes <code>system</code>. Closed beads map to <code>--all</code>. Requester-chain filtering is a separate GUI restriction, not a made-up br flag.</li><li>Native saved queries support the same filters. Run-time overrides replace the corresponding saved group, rather than appending to it. Saved-query mutation has intentionally not been added to this read-only prototype.</li><li>A colony is scoped by canonical root plus selected tracker, not its display name. This prototype switches two fictional endpoints; it does not discover or read real colonies.</li></ul><p>Verified with installed help and seven disposable Beads fixtures. No real tracker data, labels or configuration were changed. agents’ plugin labels are fictional vocabulary for that separate project, not additions to Hive’s taxonomy. System/bee-owned metadata is hidden from the label picker; unrelated task labels remain visible.</p></details>'''
(OUT/'native-filters-body.html').write_text(body)
print('Generated single-colony GUI, native label filters, and Moss/Paper themes.')
