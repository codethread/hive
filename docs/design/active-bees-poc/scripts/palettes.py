from pathlib import Path
import html
import json

OUT=Path(__file__).resolve().parent.parent/'prototypes'
VENDOR=Path(__file__).resolve().parent.parent/'vendor'
# Palette-only fork: the board, fixtures, graph and interaction code are unchanged.
source=(OUT/'work-first.html').read_text()
PALETTES={
 'moss':dict(name='Moss',note='Charcoal and sage with lime selection. The original direction, refined.',scheme='dark',bg='#111715',surface='#18221c',raised='#223027',card='#1c291f',footer='#162019',side='#161f19',top='#18231c',ink='#e3ece1',muted='#a3b29f',dim='#93a18e',line='#354333',hover='#687a5e',accent='#c0e88c',tint='#2d3d23',amber='#e3bb78',amberbg='#30291b',amberline='#625139',blue='#aac3e0',violet='#c6b3db',pink='#d0b1cd',green='#b3d98d',bug='#dfa994',recorded='#99b68c',inferred='#cbb477'),
 'graphite':dict(name='Graphite',note='Neutral charcoal with ice-blue selection. The least chromatic option.',scheme='dark',bg='#151618',surface='#1d1e21',raised='#27292e',card='#222429',footer='#1b1c20',side='#191b1f',top='#1c1e22',ink='#e8ebef',muted='#a8b0bd',dim='#959eac',line='#3b3f48',hover='#737d90',accent='#bac9e6',tint='#303947',amber='#edbf79',amberbg='#30291f',amberline='#665338',blue='#acbfdc',violet='#c8b9e1',pink='#d6b4c9',green='#a3cbb5',bug='#dfa9a4',recorded='#aaafb8',inferred='#d6bb8b'),
 'midnight':dict(name='Midnight',note='Deep navy with cyan selection. Cooler surfaces and sharper emphasis.',scheme='dark',bg='#0d1726',surface='#122034',raised='#1a2f48',card='#16283e',footer='#111f31',side='#101d2e',top='#122238',ink='#e2edfb',muted='#a2b8d4',dim='#91a9c6',line='#2d4461',hover='#597fa9',accent='#69cbf6',tint='#133c52',amber='#f1c37a',amberbg='#342b1c',amberline='#735d3b',blue='#8ebbe9',violet='#bfb3f1',pink='#d5aed5',green='#87d8b5',bug='#e7aaa2',recorded='#80a8c9',inferred='#d9bb87'),
 'aubergine':dict(name='Aubergine',note='Plum-charcoal with lavender selection. A warmer dark alternative.',scheme='dark',bg='#1b1620',surface='#251e2d',raised='#35283e',card='#2c2234',footer='#211b27',side='#221a29',top='#251d2d',ink='#eee4f2',muted='#c0aac7',dim='#af9cba',line='#493650',hover='#896798',accent='#deaff5',tint='#492e56',amber='#e8bf87',amberbg='#342a25',amberline='#735740',blue='#b6c0f0',violet='#d1b0ed',pink='#e4adcf',green='#a5cdae',bug='#ecaba5',recorded='#b7a4c4',inferred='#d9b789'),
 'paper':dict(name='Paper',note='Warm off-white with forest-green selection. The daylight alternative.',scheme='light',bg='#f0eee7',surface='#faf9f4',raised='#e7e7df',card='#fffefa',footer='#f4f3ec',side='#e9eae2',top='#eeeee6',ink='#25322b',muted='#566454',dim='#63705e',line='#cbd1c3',hover='#879782',accent='#2f684a',tint='#dce9d8',amber='#805719',amberbg='#f5ead2',amberline='#d6ba84',blue='#355d87',violet='#6d527f',pink='#844e74',green='#376545',bug='#965146',recorded='#55744e',inferred='#946c2c'),
}
css=''
for key,p in PALETTES.items():
    css+=f':root[data-palette="{key}"]'+'{color-scheme:'+p['scheme']+';'+''.join('--'+k+':'+v+';' for k,v in p.items() if k not in ('name','note','scheme'))+'--lime:var(--accent);--edge-recorded:var(--recorded);--edge-inferred:var(--inferred);}'
css+=r'''
body{background:var(--bg);color:var(--ink)}input::placeholder{color:var(--dim)}button,input,select{color:var(--ink)}.top{background:var(--top);border-color:var(--line)}.top .product{color:var(--accent)}.top .divider{color:var(--dim)}.snapshot,.muted,.toggle,.results,.reset{color:var(--muted)}.dim{color:var(--dim)}.sample{color:var(--muted);border-color:var(--line)}.toolbar{border-color:var(--line)}.toolbar input,.toolbar select{background:var(--surface);border-color:var(--line)}.segments{border-color:var(--line)}.segments button{background:var(--surface);color:var(--muted)}.segments button[aria-pressed="true"]{background:var(--tint);color:var(--accent)}.button{background:var(--raised);color:var(--muted);border-color:var(--line)}.button:hover{color:var(--ink);border-color:var(--hover)}.column-head{background:var(--bg);color:var(--muted);border-color:var(--line)}.column-dot{border-color:var(--muted)}.column-dot.in_progress{background:var(--blue);border-color:var(--blue)}.column-dot.blocked{background:var(--amber);border-color:var(--amber)}.column-dot.closed{background:var(--green);border-color:var(--green)}.work-card{background:var(--card);border-color:var(--line)}.work-card:hover{border-color:var(--hover)}.work-card.selected{border-color:var(--accent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 16%,transparent)}.work-card.blocked{border-left-color:var(--amber)}.card-id{color:var(--muted)}.card-id .issue-icon{color:var(--blue)}.card-id .issue-icon.bug{color:var(--bug)}.work-card h3 .link{color:var(--ink)}.who{background:var(--footer);border-color:var(--line)}.who-name,.map-foot .who-name{color:var(--muted)}.who .kind{color:var(--dim)}.runtime-dot{background:var(--green)}.runtime-dot.starting{background:var(--amber)}.runtime-dot.succeeded{background:var(--dim)}.priority{color:var(--muted);border-color:var(--line);background:transparent}.priority.p1{color:var(--amber);background:var(--amberbg);border-color:var(--amberline)}.dependency-strip{color:var(--amber);background:var(--amberbg);border-color:var(--amberline)}.dependency-strip .link{color:var(--amber)}
.tag{--tag-tone:var(--green);color:var(--tag-tone);background:color-mix(in srgb,var(--tag-tone) 10%,var(--surface));border-color:color-mix(in srgb,var(--tag-tone) 30%,var(--surface))}.tag[data-tone="shared"]{--tag-tone:var(--blue)}.tag[data-tone="honeycomb"]{--tag-tone:var(--amber)}.tag[data-tone="tooling"]{--tag-tone:var(--violet)}.tag[data-tone="architecture"]{--tag-tone:var(--pink)}.tag[data-tone]{color:var(--tag-tone);background:color-mix(in srgb,var(--tag-tone) 10%,var(--surface));border-color:color-mix(in srgb,var(--tag-tone) 30%,var(--surface))}.tag:hover,.tag[data-tone]:hover{color:var(--accent);border-color:var(--accent)}
.side{background:var(--side);border-color:var(--line)}.side-top{border-color:var(--line)}.side-top strong{color:var(--ink)}.side .description,.side .checks{color:var(--muted)}.side h2{color:var(--muted)}.check{color:var(--accent);border-color:var(--hover)}.check.done{background:var(--tint);border-color:var(--hover)}.chain .chain-name{color:var(--muted)}.chain .chain-meta{color:var(--dim)}.chain li:before{background:var(--recorded)}.chain li:not(:last-child):after{border-left-color:var(--recorded)}.chain li.match:not(:last-child):after{border-left-color:var(--inferred)}.chain li.current:before{background:var(--accent);box-shadow:0 0 0 3px var(--tint)}.chain li.current .chain-name{color:var(--accent)}.chain li.past .chain-name{color:var(--dim)}.chain-note{color:var(--inferred)}.execution-line{color:var(--muted);border-color:var(--line)}.board-card-link{color:var(--muted)}
.map-view{background-color:var(--bg);background-image:radial-gradient(color-mix(in srgb,var(--line) 65%,transparent) .7px,transparent .7px)}.map-group{background:var(--surface);border-color:var(--hover);box-shadow:0 3px 12px #0001}.map-group .work-card{background:var(--card)}.map-group .work-card.selected{border-color:var(--accent)}.map-group.context{background:var(--footer);color:var(--muted);border-color:var(--line)}.map-group.actor{background:var(--surface);color:var(--ink);border-color:var(--hover)}.map-foot{border-color:var(--line);color:var(--muted)}.map-meta{color:var(--dim)}.map-group.actor small{color:var(--muted)}.map-controls .button{background:var(--surface)}.map-controls .scale{background:var(--bg);color:var(--muted)}.map-view .status.open{color:var(--muted)}.status.in_progress{color:var(--blue)}.status.blocked{color:var(--amber)}.status.closed{color:var(--green)}.status.open{color:var(--muted)}.state.running{color:var(--green)}.state.starting{color:var(--amber)}.footer{border-color:var(--line);color:var(--dim)}.footer .solid{border-color:var(--recorded)}.footer .dash{border-color:var(--inferred)}
'''
# Only the SVG connector paint changes; request relationships and geometry do not.
source=source.replace("inferred?'#b6a472':'#91a981'", "inferred?'var(--edge-inferred)':'var(--edge-recorded)'")
source=source.replace('fill="#91a981"','fill="var(--edge-recorded)"').replace('fill="#b6a472"','fill="var(--edge-inferred)"')
source=source.replace('<html lang="en">','<html lang="en" data-palette="moss">')
source=source.replace('</head>','<style id="palette-tokens">'+css+'</style></head>')
script=r'''
const paletteIds = ['moss','graphite','midnight','aubergine','paper'];
function applyPalette(value){
 if(!paletteIds.includes(value)) throw new Error('Unknown preview palette: '+value);
 document.documentElement.dataset.palette=value;
}
window.addEventListener('message',event=>{
 if(event.source!==window.parent || typeof event.data!=='object' || event.data===null || event.data.kind!=='hive-palette')return;
 applyPalette(event.data.palette);
});
function paletteFromHash(){const value=location.hash.slice(1);if(value)applyPalette(value);}
window.addEventListener('hashchange',paletteFromHash);
paletteFromHash();
'''
source=source.replace('</body>','<script>'+script+'</script></body>')
source=source.replace('<title>Colony / Work</title>','<title>Colony / Work / Palette study</title>')
(OUT/'work-palettes.html').write_text(source)

body='''<p>Five palettes. Same bead-first board, same data, same interactions. Switch colors without losing your selected bead, filters or graph position.</p><fieldset style="border:0;padding:0;margin:22px 0 14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px"><legend style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">Color scheme</legend>'''
for i,(key,p) in enumerate(PALETTES.items()):
    bars=''.join(f'<span style="height:20px;flex:1;background:{p[token]}"></span>' for token in ['bg','card','accent','amber','blue'])
    body+=f'''<label data-choice="{key}" style="display:block;cursor:pointer;padding:12px;background:{p['surface']};color:{p['ink']};border:1px solid {p['line']};border-radius:7px;outline-offset:3px;{'outline:2px solid '+p['accent']+';' if i==0 else ''}"><span style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600"><input type="radio" name="palette" value="{key}" {'checked' if i==0 else ''} style="accent-color:{p['accent']};margin:0">{i+1}. {p['name']}</span><span style="display:flex;margin-top:12px;overflow:hidden;border-radius:3px">{bars}</span></label>'''
body+='</fieldset><p id="palette-caption" aria-live="polite" style="font-size:14px;margin:8px 0 16px">'+PALETTES['moss']['note']+'</p>'
body+=f'<iframe id="palette-preview" title="Interactive board and provenance map, five color schemes" sandbox="allow-scripts" srcdoc="{html.escape(source,quote=True)}" style="display:block;width:calc(100vw - 40px);height:880px;margin:20px calc(50% - 50vw + 20px);border:1px solid #7e8576;border-radius:8px;background:#111715"></iframe>'
body+='''<p>Try <strong>Work map</strong> or <strong>Trace on map</strong>, then switch palettes. Status colors, labels, selection and provenance lines are themed together. Layout and typography are unchanged; all content remains sample data.</p>'''
body+='<script>const paletteInfo='+json.dumps({k:{'note':p['note'],'accent':p['accent']} for k,p in PALETTES.items()})+r''';
const preview=document.querySelector('#palette-preview');
function selectedPalette(){return document.querySelector('input[name="palette"]:checked').value;}
function sendPalette(){preview.contentWindow.postMessage({kind:'hive-palette',palette:selectedPalette()},'*');}
preview.addEventListener('load',sendPalette);
document.querySelectorAll('input[name="palette"]').forEach(input=>input.addEventListener('change',()=>{
 const selected=selectedPalette();
 document.querySelector('#palette-caption').textContent=paletteInfo[selected].note;
 document.querySelectorAll('[data-choice]').forEach(label=>{label.style.outline=label.dataset.choice===selected?'2px solid '+paletteInfo[selected].accent:'none';});
 sendPalette();
}));
</script>'''
(OUT/'palette-body.html').write_text(body)
(OUT/'palette-values.json').write_text(json.dumps(PALETTES,indent=2))
print('Generated five live-switchable palette variants.')
