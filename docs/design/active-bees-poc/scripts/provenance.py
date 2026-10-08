from pathlib import Path
import importlib.util
import html
import json

OUT = Path(__file__).resolve().parent.parent/'prototypes'
VENDOR = Path(__file__).resolve().parent.parent/'vendor'
spec = importlib.util.spec_from_file_location('variants',Path(__file__).resolve().parent/'control-room-variants.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
bees = [dict(b) for b in base.BEES]
requesters = {'amber':'ct','cedar':'amber-quiet-otter','moss':'amber-quiet-otter','river':'cobalt-steady-owl','pearl':'cedar-bright-fox','clay':'pi'}
for i,b in enumerate(bees):
    b.update(spawn=f'spawn-{201+i}',requester=requesters[b['id']],historical=False)
bees.append(dict(id='cobalt',name='cobalt-steady-owl',kind='worker',harness='Pi',model='GPT-5',state='succeeded',age='—',attempt=1,branch='fix/picker-plan',tasks=['demo-39'],spawn='spawn-198',requester='ct',historical=True))
tasks = base.TASKS + [dict(id='demo-39',title='Plan the picker repair',status='closed',priority=2,type='task',labels=['area:honeycomb'],description='Captured the repair scope and requested follow-up implementation.',checks=[['Record the repair scope and delegation',True]],depends=[])]

css = base.CSS + r'''
.prov-toolbar{gap:10px}.prov-toolbar input{width:210px}.segments{display:flex;border:1px solid var(--line);border-radius:4px;overflow:hidden}.segments button{background:var(--surface);color:var(--muted);font-size:10px;padding:6px 10px}.segments button[aria-pressed="true"]{background:#304024;color:var(--lime)}.toggle{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:10px;white-space:nowrap}.toggle input{width:auto;height:auto;accent-color:var(--lime)}.workspace{display:grid;grid-template-columns:minmax(0,1fr) 335px;height:645px;min-height:0}.map-area{position:relative;min-width:0;background:radial-gradient(#33403580 .7px,transparent .7px);background-size:18px 18px}.graph{height:100%;width:100%;position:absolute;inset:0}.graph-controls{position:absolute;top:12px;left:14px;z-index:2;display:flex;gap:5px}.graph-controls .button{background:#1a231ddd}.selection-pane{padding:15px 17px;overflow:auto;border-left:1px solid var(--line);background:#171f1a}.pane-title{font-size:10px;font-weight:500;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:14px}.facts{display:grid;grid-template-columns:105px 1fr;gap:9px 8px;font-size:10px;margin:0 0 18px}.facts dt{color:var(--muted)}.facts dd{margin:0;overflow-wrap:anywhere}.evidence-note{font-size:10px;line-height:1.6;color:#c6b592;padding:10px 11px;border:1px solid #4c4533;background:#28261d;border-radius:4px;margin-bottom:20px}.evidence-note.direct{color:#b4c9ae;border-color:#3e4e38;background:#20281f}.small-heading{font-size:10px;font-weight:550;display:flex;justify-content:space-between;align-items:center;margin:16px 0 10px;color:var(--muted)}.inspector-task{border-top:1px solid var(--line);padding:12px 0}.inspector-task .task-name{font-size:11px;line-height:1.5;font-weight:500;margin-top:8px}.inspector-task .tags{margin-top:9px}.inspector-task .task-info{display:flex;gap:8px;align-items:center;font-size:9px}.inspector-task .status{margin-left:auto;font-size:9px}.pane-caption{font-size:10px;color:var(--muted);line-height:1.7}.pane-list{padding:0;list-style:none;font-size:11px}.pane-list button{padding:8px 0;font-size:11px;color:var(--ink)}.inspect-select{max-width:155px}.legend{display:flex;align-items:center;gap:19px;flex-wrap:wrap;padding:12px 18px;border-top:1px solid var(--line);color:var(--muted);font-size:9px}.legend>span{display:flex;align-items:center;gap:7px}.legend .line{display:inline-block;width:24px;border-top:1px solid #b4caa9}.legend .line.dashed{border-top:1px dashed #c4b186}.legend .square{height:8px;width:12px;border:1px solid #7b886e;border-radius:2px;background:#1b241e}.legend .square.past{border-style:dashed;background:#222623}.legend .note{margin-left:auto;color:var(--dim)}.outline{height:100%;overflow:auto;background:var(--bg);padding:14px}.outline-head{display:grid;grid-template-columns:minmax(210px,1fr) 108px 95px;padding:8px 12px;font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.7px;border-bottom:1px solid var(--line)}.tree{list-style:none;padding:0;margin:0}.tree .tree{margin-left:18px;padding-left:14px;border-left:1px dashed #6d654f}.tree-source{padding:12px 10px;color:var(--muted);font-size:10px}.tree-source .mono{color:var(--ink);margin-right:8px}.tree-row{display:grid;width:100%;grid-template-columns:minmax(180px,1fr) 108px 95px;gap:8px;align-items:center;text-align:left;padding:12px 9px;background:transparent;border-bottom:1px solid #273028;border-left:2px solid transparent}.tree-row:hover{background:#202c23}.tree-row[aria-pressed="true"]{background:#273322;border-left-color:var(--lime)}.tree-row.past .bee-name{color:var(--muted)}.tree-row .bee-name{font-size:11px}.tree-row .mono{color:var(--muted);font-size:9px}.tree-row .subline{margin-top:3px;font-size:9px}.tree-row .state{font-size:9px}.state.succeeded{color:#a9b6a0}.relation-title{font-size:12px;margin:0 0 12px;font-weight:550}.warning{color:#e7be78;padding:18px;font-size:12px}.graph-empty{position:absolute;bottom:18px;left:20px;color:var(--amber);font-size:11px;background:#24251b;padding:9px;border:1px solid #51482f;border-radius:4px}
@media(max-width:1100px){.workspace{grid-template-columns:minmax(0,1fr) 300px}.prov-toolbar .results{margin-left:0}.legend .note{margin-left:0}}
@media(max-width:750px){.workspace{height:auto;grid-template-columns:1fr}.map-area{height:460px}.selection-pane{border-left:0;border-top:1px solid var(--line);max-height:400px}.outline-head{display:none}.tree-row{grid-template-columns:minmax(140px,1fr) 83px}.tree-row .request-col{display:none}.prov-toolbar input{width:100%}.toggle input{width:auto}.legend{gap:10px}.prov-toolbar select{max-width:165px}}
'''

js = r'''
const requests = REQUESTS;
const tasks = TASKS;
const query = document.querySelector('#search');
const taskLabel = document.querySelector('#task-label');
const infer = document.querySelector('#infer');
const inspector = document.querySelector('#inspect');
const graphElement = document.querySelector('#graph');
const outline = document.querySelector('#outline');
let selected='cedar';
let view='graph';
let focus=false;
let cy;
let parents=new Map();
let visibleRequests=[];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusName={in_progress:'In progress',open:'Open',closed:'Closed',blocked:'Blocked'};
const symbols={in_progress:'◐',open:'○',closed:'✓',blocked:'⊘'};
const badge=t=>`<span class="status ${t.status}"><span class="symbol">${symbols[t.status]}</span>${statusName[t.status]}</span>`;
const state=r=>`<span class="state ${r.state}">${r.historical?'Succeeded':r.state==='running'?'Running':'Starting'}</span>`;
const tags=t=>`<span class="tags">${t.labels.map(l=>`<button class="tag" data-label="${l}" data-tone="${l.split(':')[1]}">${l}</button>`).join('')}</span>`;
const taskById=id=>tasks.find(t=>t.id===id);
const reqById=id=>requests.find(r=>r.id===id);
function candidate(r){
 const matches=requests.filter(other=>other.id!==r.id && other.name===r.requester);
 return matches.length===1?matches[0]:null;
}
function matches(r){
 const linked=r.tasks.map(taskById);
 return (taskLabel.value==='all'||linked.some(t=>t.labels.includes(taskLabel.value))) && [r.name,r.kind,r.spawn,r.requester,...linked.flatMap(t=>[t.title,t.id,...t.labels])].join(' ').toLowerCase().includes(query.value.trim().toLowerCase());
}
function graphData(){
 parents=new Map();
 const wanted=new Set(requests.filter(r=>!r.historical&&matches(r)).map(r=>r.id));
 // Include matched requesters as context, including historical requests. A finite visited set
 // prevents a self/cyclic name match from becoming recursive traversal.
 for(const id of wanted){let r=reqById(id);const seen=new Set([id]);while(infer.checked){const p=candidate(r);if(!p||seen.has(p.id))break;wanted.add(p.id);seen.add(p.id);r=p;}}
 if(focus && infer.checked && reqById(selected)){
   const relatives=new Set([selected]);
   let changed=true;
   while(changed){changed=false;for(const r of requests){const p=candidate(r);if(p&&relatives.has(p.id)&&!relatives.has(r.id)){relatives.add(r.id);changed=true;}}}
   let ancestor=candidate(reqById(selected));const visited=new Set([selected]);
   while(ancestor&&!visited.has(ancestor.id)){relatives.add(ancestor.id);visited.add(ancestor.id);ancestor=candidate(ancestor);}
   for(const id of wanted)if(!relatives.has(id))wanted.delete(id);
 }
 visibleRequests=requests.filter(r=>wanted.has(r.id));
 const nodes=visibleRequests.map(r=>({data:{id:r.id,kind:'request',label:`${r.name}\n${r.kind} · ${r.historical?'request succeeded':r.state}\n${r.spawn} · ${r.tasks.length} bead${r.tasks.length===1?'':'s'}`,historical:r.historical?'yes':'no'},classes:`request ${r.historical?'historical':r.state} ${r.id===selected?'chosen':''}`}));
 const edges=[];const sources=new Set();
 for(const r of visibleRequests){
   const p=infer.checked?candidate(r):null;
   let source;
   if(p&&wanted.has(p.id)){source=p.id;parents.set(r.id,{source,kind:'match'});}
   else{
     source='requester:'+r.requester;
     parents.set(r.id,{source,kind:'recorded'});
     if(!sources.has(source)){sources.add(source);nodes.push({data:{id:source,kind:'requester',identity:r.requester,label:`${r.requester}\nrequester identity`},classes:'requester'});}
   }
   edges.push({data:{id:'edge:'+r.id,source,target:r.id,kind:p&&wanted.has(p.id)?'match':'recorded'},classes:p&&wanted.has(p.id)?'match':'recorded'});
 }
 return [...nodes,...edges];
}
function renderOutline(){
 const children=source=>visibleRequests.filter(r=>parents.get(r.id).source===source);
 const seen=new Set();
 function rows(source){return children(source).filter(r=>!seen.has(r.id)).map(r=>{seen.add(r.id);return `<li><button class="tree-row ${r.historical?'past':''}" data-select="${r.id}" aria-pressed="${r.id===selected}"><span><span class="bee-name">${r.name}</span><span class="subline" style="display:block">${r.kind} · ${r.tasks.length} linked beads</span></span>${state(r)}<span class="mono request-col">${r.spawn}</span></button><ul class="tree">${rows(r.id)}</ul></li>`;}).join('');}
 const roots=[...new Set([...parents.values()].filter(p=>p.source.startsWith('requester:')).map(p=>p.source))];
 outline.innerHTML='<div class="outline-head"><span>Requester / bee</span><span>Recorded state</span><span>Request</span></div><ul class="tree">'+roots.map(id=>`<li><div class="tree-source"><span class="mono">${esc(id.slice(10))}</span>requester identity</div><ul class="tree">${rows(id)}</ul></li>`).join('')+'</ul>';
}
function render(){
 if(!infer.checked)focus=false;
 document.querySelector('#focus').textContent=focus?'All branches':'Selected branch';
 document.querySelector('#focus').setAttribute('aria-pressed',String(focus));
 const elements=graphData();
 cy.elements().remove();cy.add(elements);
 cy.layout({name:'dagre',rankDir:'LR',nodeSep:40,rankSep:55,edgeSep:18,padding:35,animate:false}).run();
 cy.nodes().ungrabify();
 cy.fit(undefined,35);if(cy.zoom()>1.12)cy.zoom(1.12);
 document.querySelector('#focus').disabled=!infer.checked;
 for(const option of inspector.options)option.disabled=!visibleRequests.some(r=>r.id===option.value);
 const active=visibleRequests.filter(r=>!r.historical&&matches(r)).length;
 const context=visibleRequests.length-active;
 document.querySelector('#results').textContent=`${active} matching active · ${context} context`;
 document.querySelector('#graph-empty').hidden=elements.length>0;
 document.querySelector('#clear').hidden=query.value===''&&taskLabel.value==='all'&&!focus;
 renderOutline();
 if(!visibleRequests.length){inspector.value='';document.querySelector('#pane').innerHTML='<p class="pane-caption">No request selected.</p>';return;}
 if(!cy.getElementById(selected).length)selected=visibleRequests[0].id;
 select(selected,false);
}
function taskCards(r){return r.tasks.map(taskById).map(t=>`<article class="inspector-task"><div class="task-info"><span class="priority p${t.priority}">P${t.priority}</span><span class="mono">${t.id}</span>${badge(t)}</div><button class="link task-name" data-task="${t.id}">${esc(t.title)}</button>${tags(t)}${t.depends.length?`<div class="blocked-note" style="margin-top:9px">↳ Needs <button class="link mono" data-task="${t.depends[0]}">${t.depends[0]}</button></div>`:''}</article>`).join('');}
function select(id,pan=true){
 selected=id;
 cy.elements().removeClass('chosen selected-edge');
 const node=cy.getElementById(id);
 node.addClass('chosen');
 if(node.isNode())node.incomers('edge').addClass('selected-edge');
 renderOutline();
 const r=reqById(id);
 document.querySelector('#focus').disabled=!infer.checked||!r;
 if(r){
   inspector.value=id;
   const p=infer.checked?candidate(r):null;
   const explanation=p?`The recorded requester matches ${p.spawn}’s friendly identity. This suggests a parent bee; the parent request and execution attempt are not recorded.`:!infer.checked?'Only recorded requester attribution is shown. No parent request or execution attempt ID is recorded.':`“${esc(r.requester)}” is recorded attribution. It has no unique matching bee request in this sample; do not infer a human, harness, or parent process from the string.`;
   document.querySelector('#pane').innerHTML=`<h2 class="pane-title">Request provenance</h2><dl class="facts"><dt>Selected request</dt><dd class="mono">${r.spawn}</dd><dt>Requester</dt><dd>${esc(r.requester)}</dd>${p?`<dt>Candidate parent</dt><dd><button class="link mono" data-select="${p.id}" style="color:var(--lime)">${p.spawn}</button> <span class="dim">· inferred</span></dd>`:'<dt>Parent request</dt><dd class="muted">Not recorded</dd>'}<dt>Recipe</dt><dd>${r.harness} / ${r.model}</dd><dt>Attempt</dt><dd>#${r.attempt}${r.historical?'':` · reserved ${esc(r.age)} ago`}</dd></dl><div class="evidence-note ${p?'':'direct'}">${explanation}</div>${r.historical?'<p class="pane-caption">Closed successful request retained as context, not counted as an active bee. Closure is not a fresh process-liveness check.</p>':''}<h3 class="small-heading">Linked beads</h3>${taskCards(r)}`;
 }else if(id.startsWith('requester:')){
   const identity=id.slice(10);const linked=visibleRequests.filter(r=>r.requester===identity);
   inspector.value='';
   document.querySelector('#pane').innerHTML=`<h2 class="pane-title">Requester attribution</h2><dl class="facts"><dt>Recorded identity</dt><dd>${esc(identity)}</dd><dt>Source field</dt><dd class="mono">created_by</dd></dl><p class="pane-caption">An attributed identity, not an authenticated parent process. Explicit actor overrides are possible.</p><h3 class="small-heading">Requested</h3><ul class="pane-list">${linked.map(r=>`<li><button class="link" data-select="${r.id}">${r.spawn} · ${r.name}</button></li>`).join('')}</ul>`;
 }
 if(pan&&view==='graph'&&node.length)cy.animate({center:{eles:node},duration:180});
}
function showEdge(edge){
 const r=reqById(edge.target().id());select(r.id,false);edge.addClass('selected-edge');
}
function setView(next){
 view=next;graphElement.hidden=next!=='graph';outline.hidden=next!=='outline';document.querySelector('#graph-controls').hidden=next!=='graph';
 document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===next)));
 if(next==='graph'){cy.resize();cy.fit(undefined,35);}
}
const graphStyles=[
 {selector:'node',style:{shape:'round-rectangle',width:218,height:72,'background-color':'#1c291f','border-width':1,'border-color':'#657656',color:'#dfe8dc',label:'data(label)','font-size':12,'font-family':'-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif','text-wrap':'wrap','text-max-width':220,'text-valign':'center','text-halign':'center','line-height':1.65,'text-outline-width':0}},
 {selector:'.starting',style:{'border-color':'#907649','background-color':'#2b281d'}},
 {selector:'.historical',style:{'border-style':'dashed','border-color':'#677368','background-color':'#202622',color:'#9aa69b'}},
 {selector:'.requester',style:{width:165,height:52,'font-size':11,shape:'round-rectangle','border-color':'#66756b','background-color':'#17201b',color:'#b4c2b8'}},
 {selector:'edge',style:{width:1.4,'curve-style':'bezier','target-arrow-shape':'triangle','arrow-scale':.7,'line-color':'#93aa84','target-arrow-color':'#93aa84'}},
 {selector:'.match',style:{'line-style':'dashed','line-dash-pattern':[6,4],'line-color':'#ad9d75','target-arrow-color':'#ad9d75'}},
 {selector:'.chosen',style:{'border-width':2,'border-color':'#c3ef8a','background-color':'#2d3b23',color:'#ecf6e4'}},
 {selector:'.selected-edge',style:{width:2.4,'line-color':'#c3ef8a','target-arrow-color':'#c3ef8a'}}
];
try{
 cy=cytoscape({container:graphElement,elements:[],style:graphStyles,layout:{name:'preset'},minZoom:.2,maxZoom:2,boxSelectionEnabled:false,autoungrabify:true,wheelSensitivity:.25});
 cy.on('tap','node',event=>select(event.target.id(),false));cy.on('tap','edge',event=>showEdge(event.target));
 for(const el of [query,taskLabel,infer])el.addEventListener(el===query?'input':'change',render);
 document.querySelector('#fit').addEventListener('click',()=>cy.fit(undefined,35));
 document.querySelector('#plus').addEventListener('click',()=>cy.zoom({level:Math.min(2,cy.zoom()*1.2),renderedPosition:{x:cy.width()/2,y:cy.height()/2}}));
 document.querySelector('#minus').addEventListener('click',()=>cy.zoom({level:Math.max(.2,cy.zoom()/1.2),renderedPosition:{x:cy.width()/2,y:cy.height()/2}}));
 document.querySelector('#focus').addEventListener('click',()=>{focus=!focus;document.querySelector('#focus').setAttribute('aria-pressed',String(focus));document.querySelector('#focus').textContent=focus?'All branches':'Selected branch';render();});
 document.querySelector('#clear').addEventListener('click',()=>{query.value='';taskLabel.value='all';focus=false;document.querySelector('#focus').textContent='Selected branch';document.querySelector('#focus').setAttribute('aria-pressed','false');render();});
 inspector.addEventListener('change',()=>select(inspector.value));
 document.addEventListener('click',event=>{
   const viewButton=event.target.closest('[data-view]');if(viewButton)setView(viewButton.dataset.view);
   const choice=event.target.closest('[data-select]');if(choice)select(choice.dataset.select);
   const labelButton=event.target.closest('[data-label]');if(labelButton){taskLabel.value=labelButton.dataset.label;document.querySelector('#task-dialog').close();render();}
   const taskButton=event.target.closest('[data-task]');if(taskButton)showTask(taskButton.dataset.task);
 });
 new ResizeObserver(()=>{cy.resize();}).observe(graphElement);
 render();
 window.provenance={cy,select,setView};
}catch(error){document.querySelector('#graph').innerHTML='<p class="warning">Graph initialization failed: '+esc(error.message)+'</p>';throw error;}
function showTask(id){
 const t=taskById(id);document.querySelector('#task-id').textContent=t.id;document.querySelector('#task-title').textContent=t.title;
 document.querySelector('#task-body').innerHTML=`<div class="row"><span class="priority p${t.priority}">P${t.priority}</span>${badge(t)}</div><div style="margin-top:14px">${tags(t)}</div><p class="description">${esc(t.description)}</p><span class="upper muted">Acceptance criteria</span><ul class="checks">${t.checks.map(([text,done])=>`<li><span class="check ${done?'done':''}" aria-label="${done?'Complete':'Incomplete'}">${done?'✓':''}</span>${esc(text)}</li>`).join('')}</ul>`;
 document.querySelector('#task-dialog').showModal();
}
document.querySelector('#close-task').addEventListener('click',()=>document.querySelector('#task-dialog').close());
'''
labels=sorted({l for t in base.TASKS for l in t['labels']})
body='''<header class="top"><div class="row"><span class="product">colony</span><span class="divider">/</span><h1>hive <span class="divider">/</span> Requester provenance</h1></div><div class="row"><span class="sample">SAMPLE</span><span class="snapshot">14:32:00</span></div></header><section class="toolbar prov-toolbar" aria-label="Provenance controls"><div class="segments"><button data-view="graph" aria-pressed="true">Graph</button><button data-view="outline" aria-pressed="false">Outline</button></div><label class="sr-only" for="search">Find bees or beads</label><input type="search" id="search" placeholder="Find bee, bead or requester…"><label class="sr-only" for="task-label">Filter task labels</label><select id="task-label"><option value="all">All task labels</option>'''+''.join(f'<option>{l}</option>' for l in labels)+'''</select><label class="toggle"><input type="checkbox" id="infer" checked>Match requester to bee</label><button class="button" id="focus" aria-pressed="false">Selected branch</button><button class="reset" id="clear" hidden>Clear</button><output id="results" class="results" aria-live="polite"></output></section><div class="workspace"><main class="map-area"><div id="graph" class="graph" role="img" aria-label="Interactive requester provenance graph. Use the Inspect selector or Outline for keyboard navigation."></div><div class="graph-controls" id="graph-controls"><button id="fit" class="button">Fit</button><button id="minus" class="button" aria-label="Zoom out">−</button><button id="plus" class="button" aria-label="Zoom in">+</button><label class="sr-only" for="inspect">Inspect request</label><select id="inspect" class="button inspect-select"><option value="" disabled>Inspect request</option>'''+''.join(f'<option value="{r["id"]}" {"selected" if r["id"]=="cedar" else ""}>{r["name"]}</option>' for r in bees)+'''</select></div><div id="outline" class="outline" hidden></div><p class="graph-empty" id="graph-empty" hidden>No matching requests.</p></main><aside class="selection-pane" id="pane" aria-live="polite"></aside></div><footer class="legend"><span><i class="line"></i>Recorded requester attribution</span><span><i class="line dashed"></i>Inferred bee-parent match</span><span><i class="square past"></i>Historical request</span><span class="note">States are recorded observations, not live process checks.</span></footer><dialog id="task-dialog" aria-labelledby="task-title"><div class="row between"><span class="mono muted" id="task-id"></span><button class="button" id="close-task">Close ×</button></div><h2 id="task-title"></h2><div id="task-body"></div></dialog>'''
js=js.replace('const requests = REQUESTS;','const requests = '+json.dumps(bees)+';').replace('const tasks = TASKS;','const tasks = '+json.dumps(tasks)+';')
libraries=''.join('<script>'+p.read_text().replace('</script','<\\/script')+'</script>' for p in [VENDOR/'cytoscape-3.34.3.min.js',VENDOR/'cytoscape-dagre-4.0.1.js'])
prototype='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Colony / Requester provenance</title><style>'+css+'</style></head><body>'+body+libraries+'<script>'+js+'</script></body></html>'
(OUT/'provenance.html').write_text(prototype)
report='''<p><strong>Yes: requester attribution is recorded. Exact bee parentage is not.</strong> Native spawn beads retain <code>created_by</code>. Worker environments set <code>BD_ACTOR</code> to the bee’s friendly identity, and <code>bee spawn</code> defaults its actor from that environment. So a child request will normally name its requesting bee.</p><p>There is no captured parent spawn-request ID. Matching that requester string to a bee is an inference: identities can collide or be overridden, and the parent could be outside the loaded history. The current <code>bee status/list</code> read model also omits <code>created_by</code>, even though native Beads retains it.</p><p><strong>Working view:</strong> keep active requests central, retain historical context when needed, and select a node to inspect its provenance and linked beads. Solid arrows show recorded identity attribution; dashed arrows show a possible bee parent. Uncheck <strong>Match requester to bee</strong> to see only raw attribution. <strong>Outline</strong> offers a denser alternative to the graph.</p>'''
report+=f'<iframe title="Requester provenance interactive prototype" sandbox="allow-scripts" srcdoc="{html.escape(prototype,quote=True)}" style="display:block;width:calc(100vw - 40px);height:820px;margin:22px calc(50% - 50vw + 20px);border:1px solid #626c5c;border-radius:8px;background:#111615"></iframe>'
report+='''<p><strong>What the sample demonstrates:</strong> amber requested cedar and moss; cedar requested pearl. Those links are dashed because they resolve requester names, not recorded parent IDs. River’s possible requester has already completed, so that request remains muted context. Clay’s requester is the string <code>pi</code>; the UI does not pretend that identifies a particular bee or harness session. All data is fictional; no live tracker was queried.</p><p><strong>Keep three relationships separate:</strong> requesting another bee, linking task beads, and replacing a failed request. Automatic retries are additional attempts on one request, not children. A native <code>supersedes</code> link is replacement history, not parentage. Harness subagents are outside this Colony request graph.</p><p><strong>For unambiguous future links:</strong> capture the requesting spawn’s stable ID and tracker authority at submission, plus the attempt ID if attempt-level provenance is needed. The worker already receives <code>HIVE_SPAWN_ID</code>, but normal submission does not persist it as parent context. That would be a data-contract change, not just a visualization feature; no such change has been made here.</p><details><summary>Source evidence and graph tooling</summary><ul><li><code>lib/colony/src/producer.smoke.test.ts:121</code> — existing smoke test asserts native <code>created_by</code> equals the requester actor.</li><li><code>lib/colony/src/bee-cli.ts:190</code> — submission actor defaults to <code>BD_ACTOR</code>.</li><li><code>lib/colony/src/launch.ts:216</code> — worker actor is the friendly identity; <code>lib/colony/src/launch.ts:226</code> injects the request ID.</li><li><code>lib/colony/src/producer.ts:113</code> — submission creates task-related links and optional supersession, not parent-request links.</li><li><code>lib/shared/src/bees-io.ts:23</code> and <code>lib/colony/src/requests.ts:70</code> — the parsed/read models omit requester attribution.</li></ul><p>Rendered with <a href="https://js.cytoscape.org/">Cytoscape.js 3.34.3</a> and <a href="https://github.com/cytoscape/cytoscape.js-dagre">cytoscape-dagre 4.0.1</a>. Pinned distributions are embedded in this prototype: automatic layout, selection, pan and zoom with no runtime CDN dependency. No packages were added to Hive.</p></details>'''
(OUT/'provenance-body.html').write_text(report)
print('Generated self-contained provenance graph and evidence report.')
