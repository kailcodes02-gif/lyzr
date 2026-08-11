// Generates a standalone HTML "Weekly Report" file, visually matching the
// hand-authored reports under repo-root reports/*.html (same dark theme,
// same Playfair Display + DM Sans fonts, same CSS class names, and the same
// self-contained "GSI / SI Conversations Pipeline" chart widget) but with
// every section driven by live data instead of manually written narrative.
//
// The CSS and widget-drawing JS below are lifted close to verbatim from
// reports/gsi-report-jun1-8.html so a generated report reads as the same
// family of document; only the embedded data changes.

export type DealRow = {
  p: string; o: string; s: 'In-conversation' | 'Demo' | 'Win' | 'Lost'
  ss: string; fc: string | null; m: string; q: string | null; a: number
}
export type DoneItem = { title: string; subtitle?: string | null; source: 'tracker' | 'custom' }
export type LeadsSummary = {
  total: number
  byVia: Record<string, number>
  rows: { name: string; email: string; company: string; via: string[] }[]
}
export type AdSpendRow = { platform: string; campaign: string | null; spend: number; leads: number | null; notes: string | null }
export type EmailCampaignRow = { name: string; sent: number; opens: number; replies: number }

export type ReportData = {
  weekLabel: string
  weekStartLabel: string
  weekEndLabel: string
  generatedLabel: string
  doneItems: DoneItem[]
  leads: LeadsSummary
  adSpend: { total: number; rows: AdSpendRow[] }
  emails: { total: number; rows: EmailCampaignRow[] }
  pipeline: DealRow[]
}

// Every free-text value below can originate from user input (done items,
// ad-spend notes, lead names pulled from HubSpot) and is interpolated
// straight into the generated HTML document, so it must be escaped.
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function money(n: number): string {
  if (!n) return '$0'
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`
  if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3)}K`
  return `$${Math.round(n).toLocaleString()}`
}

const STYLE = /* css */ `
:root{
  --bg:#0c0a08;--surface:#141210;--card:#1c1814;--card-2:#211d19;
  --border:#2e2822;--border-light:#3a332c;
  --rose:#c96a5a;--rose-dim:rgba(201,106,90,0.12);
  --amber:#d9a84c;--amber-dim:rgba(217,168,76,0.12);
  --green:#5aab8a;--green-dim:rgba(90,171,138,0.12);
  --blue:#5a8bc9;--blue-dim:rgba(90,139,201,0.12);
  --muted:#706458;--muted-dim:rgba(112,100,88,0.18);
  --text:#f0ebe4;--text-2:#9e9188;--text-3:#635a52;
}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;font-size:13.5px;line-height:1.6;min-height:100vh;}
.topbar{background:var(--surface);border-bottom:1px solid var(--border);padding:16px 40px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;}
.topbar-left{display:flex;align-items:center;gap:16px;}
.logo-mark{width:28px;height:28px;background:var(--rose);border-radius:6px;display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-size:14px;color:#fff;font-weight:600;}
.report-title{font-size:13px;font-weight:600;color:var(--text);letter-spacing:.02em;text-transform:uppercase;}
.report-sub{font-size:11.5px;color:var(--text-2);}
.main{max-width:1160px;margin:0 auto;padding:40px 40px 80px;}
.week-header{display:flex;align-items:center;gap:20px;margin-bottom:28px;margin-top:52px;padding-bottom:16px;border-bottom:1px solid var(--border);flex-wrap:wrap;}
.week-header:first-child{margin-top:0;}
.week-badge{display:inline-flex;align-items:center;gap:8px;padding:6px 16px;border-radius:4px;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;}
.week-badge.current{background:var(--rose-dim);color:var(--rose);border:1px solid rgba(201,106,90,0.3);}
.week-badge.overview{background:rgba(90,171,138,0.1);color:var(--green);border:1px solid rgba(90,171,138,0.3);}
.week-dot{width:6px;height:6px;border-radius:50%;background:currentColor;}
.week-title{font-family:'Playfair Display',serif;font-size:22px;font-weight:400;color:var(--text);letter-spacing:-0.02em;}
.week-dates{font-size:12px;color:var(--text-3);margin-left:auto;}
.badge{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:3px;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;}
.badge::before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor;}
.badge.done{background:var(--green-dim);color:var(--green);}
.badge.wip{background:var(--amber-dim);color:var(--amber);}
.badge.tracker{background:var(--blue-dim);color:var(--blue);}
.badge.custom{background:var(--muted-dim);color:var(--muted);}
.channel-block{background:var(--card);border:1px solid var(--border);border-radius:8px;margin-bottom:16px;overflow:hidden;}
.channel-head{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--border);background:var(--card-2);}
.channel-icon{width:30px;height:30px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;}
.ch-done{background:rgba(90,171,138,0.15);color:var(--green);}
.ch-leads{background:rgba(90,139,201,0.15);color:var(--blue);}
.ch-ads{background:rgba(217,168,76,0.15);color:var(--amber);}
.ch-email{background:rgba(90,171,138,0.15);color:var(--green);}
.channel-name{font-size:13px;font-weight:600;color:var(--text);}
.channel-status-row{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.channel-body{padding:16px 20px;}
.item-list{display:flex;flex-direction:column;gap:10px;}
.item{display:flex;align-items:flex-start;gap:12px;}
.item-dot{width:4px;height:4px;border-radius:50%;background:var(--border-light);margin-top:7px;flex-shrink:0;}
.item-text{flex:1;font-size:13px;color:var(--text);line-height:1.5;}
.item-badge-row{display:flex;gap:6px;flex-shrink:0;align-items:flex-start;padding-top:1px;}
.metrics-grid{display:grid;gap:1px;background:var(--border);border-radius:6px;overflow:hidden;margin-bottom:14px;}
.metrics-grid.col2{grid-template-columns:repeat(2,1fr);}
.metrics-grid.col3{grid-template-columns:repeat(3,1fr);}
.metrics-grid.col4{grid-template-columns:repeat(4,1fr);}
.metric-cell{background:var(--card);padding:14px 16px;}
.metric-val{font-family:'Playfair Display',serif;font-size:22px;font-weight:400;color:var(--text);letter-spacing:-0.02em;line-height:1.1;}
.metric-val.green{color:var(--green);}
.metric-val.amber{color:var(--amber);}
.metric-val.blue{color:var(--blue);}
.metric-label{font-size:11px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-top:4px;}
.ad-table-wrap{border:1px solid var(--border);border-radius:6px;overflow:hidden;}
.mini-table{width:100%;border-collapse:collapse;font-size:12.5px;}
.mini-table th{text-align:left;padding:7px 10px;color:var(--text-3);font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);}
.mini-table td{padding:8px 10px;color:var(--text);border-bottom:1px solid var(--border);}
.mini-table tr:last-child td{border-bottom:none;}
.mini-table tr:hover td{background:rgba(255,255,255,0.015);}
.section-eyebrow{font-size:10.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--text-3);margin-bottom:14px;}
.empty-note{font-size:12.5px;color:var(--text-3);font-style:italic;padding:6px 0;}
::-webkit-scrollbar{width:4px;height:4px;}
::-webkit-scrollbar-track{background:var(--surface);}
::-webkit-scrollbar-thumb{background:var(--border-light);border-radius:2px;}

/* ═══ WIDGET — SCOPED (lifted from reports/gsi-report-jun1-8.html) ═══ */
.gsi-w{
  --wbg:#160B07;--wcard:#20120C;--wcard2:#281610;--wcard3:#2E1A12;
  --wline:rgba(245,230,211,.08);--wline2:rgba(245,230,211,.14);
  --wink:#F5E6D3;--wmute:#A38A75;--wdim:#6E5847;
  --wacc:#E07A5F;--wacc2:#F2A07B;
  --wconv:#D97757;--wdemo:#5B8CD6;--wwin:#D9C14A;--wlost:#C46980;--wcust:#5FA890;
  --wsellthru:#E07A5F;--wsellwith:#B07AA1;--winternal:#6195C6;--wcustomer:#5FA890;--wdirect:#8E8378;
  background:var(--wbg);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:32px;position:relative;
}
.gsi-w::before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(1200px 600px at 90% -10%,rgba(224,122,95,.08),transparent 60%),radial-gradient(900px 500px at -10% 110%,rgba(95,168,144,.04),transparent 60%);}
.gsi-w .ww{position:relative;z-index:1;padding:28px 28px 32px;}
.gsi-w .whead{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:22px;}
.gsi-w .wtitle{font-family:'Playfair Display',serif;font-weight:500;font-size:clamp(24px,2.8vw,36px);line-height:1.05;letter-spacing:-0.01em;color:var(--wink);margin:0 0 5px;}
.gsi-w .wtitle em{font-style:italic;color:var(--wacc2);font-weight:400;}
.gsi-w .wsub{font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--wmute);font-weight:500;}
.gsi-w .wfilters{display:flex;gap:6px;background:rgba(245,230,211,.03);border:1px solid var(--wline);padding:5px;border-radius:999px;}
.gsi-w .wfilt{border:0;background:transparent;color:var(--wmute);font:500 12px/1 'DM Sans',sans-serif;padding:8px 14px;border-radius:999px;cursor:pointer;transition:all .25s cubic-bezier(.22,1,.36,1);}
.gsi-w .wfilt:hover{color:var(--wink);}
.gsi-w .wfilt.active{background:var(--wink);color:var(--wbg);font-weight:600;}
.gsi-w .wkpis{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:14px;}
.gsi-w .wkpi{background:linear-gradient(180deg,var(--wcard2),var(--wcard));border:1px solid var(--wline);border-radius:14px;padding:16px 14px 18px;position:relative;overflow:hidden;transition:border-color .2s;}
.gsi-w .wkpi:hover{border-color:var(--wline2);}
.gsi-w .wkpi::after{content:"";position:absolute;left:0;right:0;top:0;height:1px;background:linear-gradient(90deg,transparent,rgba(245,230,211,.18),transparent);}
.gsi-w .wkpi-label{font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--wmute);margin-bottom:12px;font-weight:500;white-space:nowrap;}
.gsi-w .wkpi-val{font-family:'Playfair Display',serif;font-weight:400;font-size:clamp(22px,2.4vw,32px);line-height:1;color:var(--wink);font-variant-numeric:tabular-nums;}
.gsi-w .wkpi-val.win{color:var(--wwin);}
.gsi-w .wkpi-val.lost{color:var(--wlost);}
.gsi-w .wkpi-val.cust{color:var(--wcust);}
.gsi-w .wkpi-note{font-size:10px;color:var(--wdim);margin-top:6px;}
.gsi-w .wacvstrip{display:grid;grid-template-columns:1.4fr 1fr;gap:10px;margin-bottom:22px;}
.gsi-w .wacvcard{border:1px solid var(--wline);border-radius:14px;padding:18px 22px;display:flex;align-items:center;justify-content:space-between;gap:18px;}
.gsi-w .wacvcard.closed{background:linear-gradient(135deg,rgba(217,193,74,.12),rgba(217,193,74,.03));border-color:rgba(217,193,74,.25);}
.gsi-w .wacvcard.open{background:linear-gradient(135deg,rgba(224,122,95,.08),rgba(224,122,95,.02));border-color:rgba(224,122,95,.18);}
.gsi-w .wacvlabel{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--wmute);font-weight:500;}
.gsi-w .wacvcard.closed .wacvlabel{color:var(--wwin);}
.gsi-w .wacvmeta{font-size:12px;color:var(--wdim);margin-top:4px;}
.gsi-w .wacvval{font-family:'Playfair Display',serif;font-style:italic;font-weight:400;font-size:clamp(26px,2.8vw,36px);line-height:1;color:var(--wink);font-variant-numeric:tabular-nums;}
.gsi-w .wacvcard.closed .wacvval{color:var(--wwin);}
.gsi-w .wacvcard.open .wacvval{color:var(--wacc2);}
.gsi-w .wtabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;}
.gsi-w .wtab{border:1px solid var(--wline);background:transparent;color:var(--wmute);font:500 12px/1 'DM Sans',sans-serif;padding:10px 16px;border-radius:999px;cursor:pointer;transition:all .25s cubic-bezier(.22,1,.36,1);}
.gsi-w .wtab:hover{color:var(--wink);border-color:var(--wline2);}
.gsi-w .wtab.active{background:rgba(245,230,211,.06);color:var(--wink);border-color:var(--wline2);}
.gsi-w .wlegend{display:flex;gap:16px;flex-wrap:wrap;margin:4px 2px 12px;font-size:12px;color:var(--wmute);}
.gsi-w .wlg{display:inline-flex;align-items:center;gap:7px;}
.gsi-w .wdot{width:9px;height:9px;border-radius:999px;display:inline-block;}
.gsi-w .wchart{background:var(--wcard);border:1px solid var(--wline);border-radius:14px;padding:22px 20px 16px;min-height:400px;position:relative;}
.gsi-w .wsvg{width:100%;height:auto;display:block;overflow:visible;}
.gsi-w .wgrid line{stroke:var(--wline);stroke-dasharray:2 4;}
.gsi-w .watick{fill:var(--wmute);font:400 12px 'DM Sans',sans-serif;font-variant-numeric:tabular-nums;}
.gsi-w .wbn{fill:var(--wink);font:600 12px 'DM Sans',sans-serif;font-variant-numeric:tabular-nums;}
.gsi-w .wpl{fill:var(--wink);font:500 13px 'DM Sans',sans-serif;}
.gsi-w .wpl.acc{fill:var(--wacc2);font-weight:600;}
.gsi-w .wtip{position:absolute;pointer-events:none;background:#2C1A12;border:1px solid var(--wline2);border-radius:10px;padding:10px 12px;font-size:12px;color:var(--wink);box-shadow:0 12px 30px -10px rgba(0,0,0,.6);opacity:0;transform:translateY(-4px);transition:opacity .15s,transform .15s;z-index:50;min-width:180px;}
.gsi-w .wtip.show{opacity:1;transform:translateY(0);}
.gsi-w .wtip .th{font-family:'Playfair Display',serif;font-weight:500;font-size:14px;margin-bottom:6px;color:var(--wink);}
.gsi-w .wtip .tr{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:2px 0;color:var(--wmute);}
.gsi-w .wtip .tr b{color:var(--wink);font-weight:600;font-variant-numeric:tabular-nums;}
.gsi-w .wtip .ld{width:8px;height:8px;border-radius:999px;display:inline-block;margin-right:6px;vertical-align:middle;}
.gsi-w .wfoot{text-align:right;font-size:11px;color:var(--wdim);margin-top:10px;letter-spacing:.04em;}
@keyframes wBV{from{transform:scaleY(0);opacity:.3}to{transform:scaleY(1);opacity:1}}
@keyframes wBH{from{transform:scaleX(0);opacity:.3}to{transform:scaleX(1);opacity:1}}
@keyframes wFD{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
.gsi-w .wAv{animation:wBV .6s cubic-bezier(.22,1,.36,1) backwards;transform-origin:bottom;}
.gsi-w .wAh{animation:wBH .65s cubic-bezier(.22,1,.36,1) backwards;transform-origin:left;}
.gsi-w .wAf{animation:wFD .45s cubic-bezier(.22,1,.36,1) backwards;}
.gsi-w .wseg{transition:filter .15s,opacity .15s;cursor:pointer;}
.gsi-w .wseg:hover{filter:brightness(1.18);}
@media(max-width:980px){.gsi-w .wkpis{grid-template-columns:repeat(3,1fr);}.gsi-w .wacvstrip{grid-template-columns:1fr;}}
@media(max-width:600px){.gsi-w .wkpis{grid-template-columns:repeat(2,1fr);}.gsi-w .ww{padding:18px 14px 24px;}}
@media(max-width:768px){.main{padding:24px 16px;}.topbar{padding:12px 16px;}.metrics-grid{grid-template-columns:repeat(2,1fr)!important;}}
`

// Widget chart-drawing JS, lifted near-verbatim from the reference report.
// Reads live rows from #wd instead of a hand-typed JSON blob; motion
// categories (MO) are the real `dealtype` values (see hubspot-deals.js)
// rather than the invented ones in the original hand-authored report.
const WIDGET_JS = /* js */ `
(function(){
  var ROWS=JSON.parse(document.getElementById('wd').textContent);
  var WR=document.querySelector('.gsi-w');
  function gC(v){return getComputedStyle(WR).getPropertyValue(v).trim();}
  var SO=["In-conversation","Demo","Win","Lost"];
  var SC={"In-conversation":gC('--wconv'),"Demo":gC('--wdemo'),"Win":gC('--wwin'),"Lost":gC('--wlost')};
  var MO=["New Business","Expansion","Partnership","POC"];
  var MCOL=[gC('--wsellthru'),gC('--wsellwith'),gC('--winternal'),gC('--wcustomer')];
  var MC={}; MO.forEach(function(m,i){MC[m]=MCOL[i];});
  var ST={filter:'all',tab:'timeline'};
  var PARTNERS=Array.from(new Set(ROWS.map(function(r){return r.p;}))).sort();
  function FR(){return ROWS.filter(function(r){if(ST.filter==='all')return true;return r.p===ST.filter;});}
  function mF(n){if(!n)return'$0';if(n>=1e6)return'$'+(n/1e6).toFixed(2).replace(/\\.?0+$/,'')+'M';if(n>=1e3)return'$'+Math.round(n/1e3)+'K';return'$'+n;}
  function pct(a,b){return b?Math.round(a*100/b)+'%':'0%';}
  function sv(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
  function renderKPIs(){
    var all=FR(),tot=all.length,wins=all.filter(function(r){return r.s==='Win';}).length,lost=all.filter(function(r){return r.s==='Lost';}).length,demos=all.filter(function(r){return r.s==='Demo';}).length,ongoing=tot-wins-lost,custs=all.filter(function(r){return r.m==='Expansion';}).length;
    sv('k-total',tot);sv('k-ongoing',ongoing);sv('k-demos',demos);sv('k-wins',wins);sv('k-losses',lost);sv('k-customers',custs);
    var cACV=all.filter(function(r){return r.s==='Win';}).reduce(function(a,r){return a+(r.a||0);},0);
    var oACV=all.filter(function(r){return r.s!=='Win'&&r.s!=='Lost';}).reduce(function(a,r){return a+(r.a||0);},0);
    sv('acv-closed',mF(cACV));sv('acv-open',mF(oACV));sv('acv-closed-meta',wins+' deal'+(wins===1?'':'s')+' won');sv('acv-open-meta',ongoing+' ongoing');
  }
  function renderFilters(){
    var el=document.getElementById('wfilters');
    if(!el)return;
    var html='<button class="wfilt'+(ST.filter==='all'?' active':'')+'" data-wf="all">All</button>';
    PARTNERS.forEach(function(p){html+='<button class="wfilt'+(ST.filter===p?' active':'')+'" data-wf="'+p+'">'+p+'</button>';});
    el.innerHTML=html;
    el.querySelectorAll('.wfilt').forEach(function(b){b.addEventListener('click',function(){ST.filter=b.dataset.wf;render();});});
  }
  function renderLegend(){
    var el=document.getElementById('wlegend');
    if(ST.tab==='motion'){el.innerHTML=MO.map(function(m){return'<span class="wlg"><span class="wdot" style="background:'+MC[m]+'"></span>'+m+'</span>';}).join('');}
    else{el.innerHTML=SO.map(function(s_){return'<span class="wlg"><span class="wdot" style="background:'+SC[s_]+'"></span>'+s_+'</span>';}).join('')+'<span class="wlg"><span class="wdot" style="background:'+gC('--wcust')+'"></span>Customer (Expansion)</span>';}
  }
  var tip=document.getElementById('wtip');
  function showTip(x,y,html){tip.innerHTML=html;tip.classList.add('show');var cc=document.querySelector('.wchart').getBoundingClientRect();var tx=x-cc.left+14,ty=y-cc.top+14,tw=tip.offsetWidth,th=tip.offsetHeight;if(tx+tw>cc.width)tx=x-cc.left-tw-14;if(ty+th>cc.height)ty=y-cc.top-th-14;tip.style.left=tx+'px';tip.style.top=ty+'px';}
  function hideTip(){tip.classList.remove('show');}
  function wire(){document.querySelectorAll('.wseg').forEach(function(el){el.addEventListener('mousemove',function(e){var r=el.getAttribute('dt');if(r)showTip(e.clientX,e.clientY,decodeURIComponent(r));});el.addEventListener('mouseleave',hideTip);});}
  function nM(v){if(v<=5)return 5;if(v<=10)return 10;if(v<=20)return 20;if(v<=30)return 30;if(v<=50)return 50;if(v<=80)return 80;return Math.ceil(v/20)*20;}
  function sTip(title,counts,total){var r='<div class="th">'+title+'</div>';SO.forEach(function(st){var v=counts[st]||0;if(!v)return;r+='<div class="tr"><span><span class="ld" style="background:'+SC[st]+'"></span>'+st+'</span><b>'+v+'</b></div>';});r+='<div class="tr" style="border-top:1px solid rgba(245,230,211,.14);margin-top:6px;padding-top:6px;"><span>Total</span><b>'+total+'</b></div>';return r;}
  function setSVG(inner,W,H,foot){var c=document.getElementById('wchart');c.setAttribute('viewBox','0 0 '+W+' '+H);c.innerHTML=inner;wire();document.getElementById('wfoot').textContent=foot;}
  function chartTimeline(rows){var W=1000,H=460,pL=56,pR=28,pT=36,pB=56,plotW=W-pL-pR,plotH=H-pT-pB,order=["Q1 2025","Q2 2025","Q3 2025","Q4 2025","Q1 2026","Q2 2026","Q3 2026","Q4 2026"],present=new Set(rows.map(function(r){return r.q;})),qs=order.filter(function(q){return present.has(q);}),groups={};qs.forEach(function(q){groups[q]={};SO.forEach(function(s_){groups[q][s_]=0;});});rows.forEach(function(r){if(qs.includes(r.q))groups[r.q][r.s]=(groups[r.q][r.s]||0)+1;});var totals=qs.map(function(q){return SO.reduce(function(s_,k){return s_+groups[q][k];},0);}),yMax=nM(Math.max(1,Math.max.apply(null,totals.length?totals:[0]))),slot=plotW/Math.max(1,qs.length),barW=Math.min(72,slot*0.6),svg='<g class="wgrid">';for(var i=0;i<=5;i++){var v=Math.round(yMax*i/5),y=pT+plotH-(v/yMax)*plotH;svg+='<line x1="'+pL+'" x2="'+(W-pR)+'" y1="'+y+'" y2="'+y+'"/><text class="watick" x="'+(pL-12)+'" y="'+(y+4)+'" text-anchor="end">'+v+'</text>';}svg+='</g>';qs.forEach(function(q,i){var cx=pL+slot*i+slot/2,x=cx-barW/2,yc=pT+plotH,total=totals[i];SO.forEach(function(st){var v=groups[q][st];if(!v)return;var h=(v/yMax)*plotH;yc-=h;svg+='<rect class="wseg wAv" x="'+x+'" y="'+yc+'" width="'+barW+'" height="'+h+'" rx="2" fill="'+SC[st]+'" dt="'+encodeURIComponent(sTip(q,groups[q],total))+'" style="animation-delay:'+(i*60)+'ms"></rect>';});if(total){var yt=pT+plotH-(total/yMax)*plotH;svg+='<text class="wbn wAf" x="'+cx+'" y="'+(yt-8)+'" text-anchor="middle" style="animation-delay:'+(i*60+350)+'ms">'+total+'</text>';}svg+='<text class="watick" x="'+cx+'" y="'+(H-pB+22)+'" text-anchor="middle">'+q+'</text>';});setSVG(svg,W,H,'Projected close quarter · '+rows.length+' rows');}
  function chartCompanies(rows){var map={};rows.forEach(function(r){if(!map[r.p]){map[r.p]={total:0};SO.forEach(function(s_){map[r.p][s_]=0;});}map[r.p][r.s]++;map[r.p].total++;});var entries=Object.entries(map).sort(function(a,b){return b[1].total-a[1].total;});if(entries.length>14)entries=entries.slice(0,14);var W=1000,H=Math.max(420,50+entries.length*34),pL=170,pR=60,pT=22,plotW=W-pL-pR,rowH=22,rowGap=12,maxT=Math.max(1,Math.max.apply(null,entries.length?entries.map(function(e){return e[1].total;}):[0])),svg='';entries.forEach(function(e,i){var p=e[0],c=e[1],y=pT+i*(rowH+rowGap),cy=y+rowH/2+5;svg+='<text class="wpl" x="'+(pL-12)+'" y="'+cy+'" text-anchor="end">'+p+'</text>';var x=pL;SO.forEach(function(st){var v=c[st];if(!v)return;var w=(v/maxT)*plotW;svg+='<rect class="wseg wAh" x="'+x+'" y="'+y+'" width="'+w+'" height="'+rowH+'" rx="3" fill="'+SC[st]+'" dt="'+encodeURIComponent(sTip(p,c,c.total))+'" style="animation-delay:'+(i*40)+'ms"></rect>';x+=w;});svg+='<text class="wbn wAf" x="'+(x+10)+'" y="'+cy+'" style="animation-delay:'+(i*40+350)+'ms">'+c.total+'</text>';});setSVG(svg,W,H,entries.length+' partners · '+rows.length+' rows');}
  function chartMotion(rows){var map={};MO.forEach(function(m){map[m]={total:0,value:0,byS:{}};SO.forEach(function(s_){map[m].byS[s_]=0;});});rows.forEach(function(r){var m=r.m||'New Business';if(!map[m]){map[m]={total:0,value:0,byS:{}};SO.forEach(function(s_){map[m].byS[s_]=0;});}map[m].total++;map[m].value+=(r.a||0);map[m].byS[r.s]=(map[m].byS[r.s]||0)+1;});var entries=MO.filter(function(m){return map[m].total>0;}).map(function(m){return[m,map[m]];}),W=1000,H=460,pL=200,pR=140,pT=32,plotW=W-pL-pR,rowH=50,rowGap=18,maxT=Math.max(1,Math.max.apply(null,entries.length?entries.map(function(e){return e[1].total;}):[0])),svg='';entries.forEach(function(e,i){var motion=e[0],c=e[1],y=pT+i*(rowH+rowGap),cy=y+rowH/2+6;svg+='<rect x="'+(pL-160)+'" y="'+y+'" width="5" height="'+rowH+'" rx="2.5" fill="'+MC[motion]+'"/><text class="wpl" x="'+(pL-148)+'" y="'+(y+18)+'" text-anchor="start" font-size="14" font-weight="500">'+motion+'</text><text x="'+(pL-148)+'" y="'+(y+36)+'" text-anchor="start" fill="'+gC('--wdim')+'" font-size="11" font-family="DM Sans" letter-spacing="0.04em">'+mF(c.value)+' pipeline value</text>';var totalW=(c.total/maxT)*plotW,x=pL;SO.forEach(function(st){var v=c.byS[st];if(!v)return;var w=(v/c.total)*totalW;var tipH='<div class="th">'+motion+'</div>'+SO.map(function(ss){return c.byS[ss]?'<div class="tr"><span><span class="ld" style="background:'+SC[ss]+'"></span>'+ss+'</span><b>'+c.byS[ss]+'</b></div>':'';}).join('')+'<div class="tr" style="border-top:1px solid rgba(245,230,211,.14);margin-top:6px;padding-top:6px;"><span>Pipeline</span><b>'+mF(c.value)+'</b></div>';svg+='<rect class="wseg wAh" x="'+x+'" y="'+(y+10)+'" width="'+w+'" height="'+(rowH-20)+'" rx="3" fill="'+SC[st]+'" dt="'+encodeURIComponent(tipH)+'" style="animation-delay:'+(i*80)+'ms"></rect>';x+=w;});svg+='<text class="wbn wAf" x="'+(x+12)+'" y="'+cy+'" text-anchor="start" font-size="18" font-family="Playfair Display" font-style="italic" style="animation-delay:'+(i*80+350)+'ms">'+c.total+'</text>';});setSVG(svg,W,H,'Motion breakdown · '+rows.length+' rows');}
  function chartStages(rows){var W=1000,H=460,cx=280,cy=H/2,rI=96,rO=150,counts={};SO.forEach(function(s_){counts[s_]=0;});rows.forEach(function(r){counts[r.s]++;});var total=rows.length||1,angle=-Math.PI/2,svg='';SO.forEach(function(st,i){var v=counts[st];if(!v)return;var a=(v/total)*Math.PI*2,a2=angle+a,lg=(a2-angle)>Math.PI?1:0,x1=cx+rO*Math.cos(angle),y1=cy+rO*Math.sin(angle),x2=cx+rO*Math.cos(a2),y2=cy+rO*Math.sin(a2),x3=cx+rI*Math.cos(a2),y3=cy+rI*Math.sin(a2),x4=cx+rI*Math.cos(angle),y4=cy+rI*Math.sin(angle),d='M '+x1+' '+y1+' A '+rO+' '+rO+' 0 '+lg+' 1 '+x2+' '+y2+' L '+x3+' '+y3+' A '+rI+' '+rI+' 0 '+lg+' 0 '+x4+' '+y4+' Z',tip='<div class="th">'+st+'</div><div class="tr"><span>Count</span><b>'+v+'</b></div><div class="tr"><span>Share</span><b>'+pct(v,total)+'</b></div>';svg+='<path class="wseg wAf" d="'+d+'" fill="'+SC[st]+'" dt="'+encodeURIComponent(tip)+'" style="animation-delay:'+(i*100)+'ms"/>';angle=a2;});svg+='<text x="'+cx+'" y="'+(cy-6)+'" text-anchor="middle" font-family="Playfair Display" font-style="italic" font-size="48" fill="'+gC('--wink')+'">'+total+'</text><text x="'+cx+'" y="'+(cy+22)+'" text-anchor="middle" font-family="DM Sans" font-size="11" letter-spacing="2" fill="'+gC('--wmute')+'">CONVERSATIONS</text>';var lx=580,ly=90;SO.forEach(function(st,i){var v=counts[st],p=pct(v,total),dim=v===0?0.4:1;svg+='<g style="opacity:'+dim+'"><rect x="'+lx+'" y="'+(ly-14)+'" width="10" height="10" rx="2" fill="'+SC[st]+'"/><text x="'+(lx+20)+'" y="'+(ly-5)+'" fill="'+gC('--wink')+'" font-family="DM Sans" font-size="15" font-weight="500">'+st+'</text><text x="'+(lx+320)+'" y="'+(ly-5)+'" text-anchor="end" fill="'+gC('--wink')+'" font-family="DM Sans" font-size="20" font-weight="500" font-variant-numeric="tabular-nums">'+v+'</text><text x="'+(lx+360)+'" y="'+(ly-5)+'" text-anchor="end" fill="'+gC('--wmute')+'" font-family="DM Sans" font-size="13" font-variant-numeric="tabular-nums">'+p+'</text></g>';ly+=60;});setSVG(svg,W,H,'Status mix · '+rows.length+' rows');}
  function chartSubstages(rows){var counts={};rows.forEach(function(r){counts[r.ss]=(counts[r.ss]||0)+1;});var present=Object.keys(counts).sort(function(a,b){return counts[b]-counts[a];}),W=1000,H=Math.max(360,40+present.length*46),pL=170,pR=60,pT=22,plotW=W-pL-pR,rowH=26,rowGap=16,mx=Math.max(1,Math.max.apply(null,present.length?present.map(function(k){return counts[k];}):[0])),svg='';present.forEach(function(k,i){var y=pT+i*(rowH+rowGap),cy=y+rowH/2+5,v=counts[k],w=(v/mx)*plotW,tip='<div class="th">'+k+'</div><div class="tr"><span>Count</span><b>'+v+'</b></div><div class="tr"><span>Share</span><b>'+pct(v,rows.length)+'</b></div>';svg+='<text class="wpl" x="'+(pL-12)+'" y="'+cy+'" text-anchor="end">'+k+'</text><rect class="wseg wAh" x="'+pL+'" y="'+y+'" width="'+w+'" height="'+rowH+'" rx="3" fill="'+gC('--wconv')+'" dt="'+encodeURIComponent(tip)+'" style="animation-delay:'+(i*50)+'ms"></rect><text class="wbn wAf" x="'+(pL+w+10)+'" y="'+cy+'" style="animation-delay:'+(i*50+350)+'ms">'+v+'</text>';});setSVG(svg,W,H,'Sub-stage (real HubSpot stage) · '+rows.length+' rows');}
  function chartACV(rows){var map={};rows.forEach(function(r){var v=r.a||0;if(!v)return;if(!map[r.p])map[r.p]={closed:0,open:0};if(r.s==='Win')map[r.p].closed+=v;else if(r.s!=='Lost')map[r.p].open+=v;});var entries=Object.entries(map).map(function(e){return[e[0],Object.assign({},e[1],{total:e[1].closed+e[1].open})];}).sort(function(a,b){return b[1].total-a[1].total;});if(entries.length>12)entries=entries.slice(0,12);var W=1000,H=Math.max(380,50+entries.length*38),pL=170,pR=150,pT=22,plotW=W-pL-pR,rowH=22,rowGap=14,maxV=Math.max(1,Math.max.apply(null,entries.length?entries.map(function(e){return e[1].total;}):[0])),svg='<g class="wAf"><rect x="'+pL+'" y="0" width="14" height="14" rx="2" fill="'+gC('--wwin')+'"/><text x="'+(pL+22)+'" y="12" fill="'+gC('--wmute')+'" font-family="DM Sans" font-size="12">Closed (won)</text><rect x="'+(pL+140)+'" y="0" width="14" height="14" rx="2" fill="'+gC('--wacc2')+'" opacity=".85"/><text x="'+(pL+162)+'" y="12" fill="'+gC('--wmute')+'" font-family="DM Sans" font-size="12">Open pipeline</text></g>',totC=0,totO=0;entries.forEach(function(e,i){var p=e[0],c=e[1],y=pT+i*(rowH+rowGap),cy=y+rowH/2+5;totC+=c.closed;totO+=c.open;svg+='<text class="wpl" x="'+(pL-12)+'" y="'+cy+'" text-anchor="end">'+p+'</text>';var x=pL;if(c.closed>0){var w=(c.closed/maxV)*plotW,tip='<div class="th">'+p+'</div><div class="tr"><span>Closed</span><b>'+mF(c.closed)+'</b></div><div class="tr"><span>Open</span><b>'+mF(c.open)+'</b></div>';svg+='<rect class="wseg wAh" x="'+x+'" y="'+y+'" width="'+w+'" height="'+rowH+'" rx="3" fill="'+gC('--wwin')+'" dt="'+encodeURIComponent(tip)+'" style="animation-delay:'+(i*50)+'ms"></rect>';x+=w;}if(c.open>0){var w2=(c.open/maxV)*plotW,tip2='<div class="th">'+p+'</div><div class="tr"><span>Closed</span><b>'+mF(c.closed)+'</b></div><div class="tr"><span>Open</span><b>'+mF(c.open)+'</b></div>';svg+='<rect class="wseg wAh" x="'+x+'" y="'+y+'" width="'+w2+'" height="'+rowH+'" rx="3" fill="'+gC('--wacc2')+'" opacity=".85" dt="'+encodeURIComponent(tip2)+'" style="animation-delay:'+(i*50)+'ms"></rect>';x+=w2;}svg+='<text class="wbn wAf" x="'+(x+10)+'" y="'+cy+'" style="animation-delay:'+(i*50+350)+'ms">'+mF(c.total)+'</text>';});setSVG(svg,W,H,'Closed '+mF(totC)+' · Open '+mF(totO)+' · '+entries.length+' partners');}
  function render(){var rows=FR();renderKPIs();renderLegend();hideTip();if(!rows.length){setSVG('<text x="500" y="230" text-anchor="middle" fill="'+gC('--wmute')+'" font-family="DM Sans" font-size="14">No pipeline data for this filter</text>',1000,460,'0 rows');return;}if(ST.tab==='timeline')chartTimeline(rows);else if(ST.tab==='companies')chartCompanies(rows);else if(ST.tab==='motion')chartMotion(rows);else if(ST.tab==='stages')chartStages(rows);else if(ST.tab==='substages')chartSubstages(rows);else if(ST.tab==='acv')chartACV(rows);}
  document.querySelectorAll('.wtab').forEach(function(b){b.addEventListener('click',function(){document.querySelectorAll('.wtab').forEach(function(x){x.classList.remove('active');});b.classList.add('active');ST.tab=b.dataset.wt;render();});});
  renderFilters();
  render();
})();
`

function renderPipelineWidget(rows: DealRow[]): string {
  const json = JSON.stringify(rows).replace(/</g, '\\u003c')
  return `
<div id="overview" class="week-header" style="margin-top:0;">
  <span class="week-badge overview"><span class="week-dot"></span>Live</span>
  <h2 class="week-title">GSI / SI Conversations Pipeline</h2>
  <span class="week-dates">Synced from HubSpot · ${rows.length} deal${rows.length === 1 ? '' : 's'}</span>
</div>
<div class="gsi-w">
  <div class="ww">
    <div class="whead">
      <div>
        <h2 class="wtitle">GSI / SI <em>conversations</em></h2>
        <div class="wsub">Live partnership pipeline · HubSpot-synced (deals with the "GSI" property set)</div>
      </div>
      <div class="wfilters" id="wfilters"></div>
    </div>
    <section class="wkpis">
      <div class="wkpi"><div class="wkpi-label">Total</div><div class="wkpi-val" id="k-total">—</div><div class="wkpi-note">conversations</div></div>
      <div class="wkpi"><div class="wkpi-label">Ongoing</div><div class="wkpi-val" id="k-ongoing">—</div><div class="wkpi-note">in flight</div></div>
      <div class="wkpi"><div class="wkpi-label">Demos</div><div class="wkpi-val" id="k-demos">—</div><div class="wkpi-note">late stage</div></div>
      <div class="wkpi"><div class="wkpi-label">Wins</div><div class="wkpi-val win" id="k-wins">—</div><div class="wkpi-note">closed won</div></div>
      <div class="wkpi"><div class="wkpi-label">Losses</div><div class="wkpi-val lost" id="k-losses">—</div><div class="wkpi-note">closed lost</div></div>
      <div class="wkpi"><div class="wkpi-label">Expansions</div><div class="wkpi-val cust" id="k-customers">—</div><div class="wkpi-note">existing accounts</div></div>
    </section>
    <section class="wacvstrip">
      <div class="wacvcard closed"><div><div class="wacvlabel">★ Closed ACV</div><div class="wacvmeta" id="acv-closed-meta">—</div></div><div class="wacvval" id="acv-closed">—</div></div>
      <div class="wacvcard open"><div><div class="wacvlabel">Open pipeline ACV</div><div class="wacvmeta" id="acv-open-meta">—</div></div><div class="wacvval" id="acv-open">—</div></div>
    </section>
    <nav class="wtabs">
      <button class="wtab active" data-wt="timeline">Timeline</button>
      <button class="wtab" data-wt="companies">Partners</button>
      <button class="wtab" data-wt="motion">Deal type</button>
      <button class="wtab" data-wt="stages">Stage mix</button>
      <button class="wtab" data-wt="substages">HubSpot stage</button>
      <button class="wtab" data-wt="acv">ACV</button>
    </nav>
    <div class="wlegend" id="wlegend"></div>
    <div class="wchart">
      <svg id="wchart" class="wsvg" viewBox="0 0 1000 460" preserveAspectRatio="xMidYMid meet"></svg>
      <div class="wtip" id="wtip"></div>
      <div class="wfoot" id="wfoot"></div>
    </div>
  </div>
</div>
<script id="wd" type="application/json">${json}</script>
<script>${WIDGET_JS}</script>`
}

function renderDone(items: DoneItem[]): string {
  if (!items.length) {
    return `<div class="channel-block"><div class="channel-body"><p class="empty-note">Nothing marked done this week yet.</p></div></div>`
  }
  const rows = items.map(it => `
    <div class="item">
      <div class="item-dot"></div>
      <div class="item-text">${esc(it.title)}${it.subtitle ? ` — <span style="color:var(--text-2)">${esc(it.subtitle)}</span>` : ''}</div>
      <div class="item-badge-row"><span class="badge ${it.source === 'tracker' ? 'tracker' : 'custom'}">${it.source === 'tracker' ? 'Tracker' : 'Added'}</span></div>
    </div>`).join('')
  return `
<div class="channel-block">
  <div class="channel-head">
    <div class="channel-icon ch-done">✓</div>
    <span class="channel-name">Done This Week</span>
    <div class="channel-status-row"><span class="badge done">${items.length} item${items.length === 1 ? '' : 's'}</span></div>
  </div>
  <div class="channel-body"><div class="item-list">${rows}</div></div>
</div>`
}

function renderLeads(leads: LeadsSummary): string {
  const viaCells = Object.entries(leads.byVia)
    .map(([via, n]) => `<div class="metric-cell"><div class="metric-val blue">${n}</div><div class="metric-label">via ${esc(via)}</div></div>`)
    .join('')
  const rows = leads.rows.slice(0, 25).map(r => `
    <tr><td>${esc(r.name || '—')}</td><td>${esc(r.email)}</td><td>${esc(r.company || '—')}</td><td>${esc((r.via || []).join(', '))}</td></tr>`).join('')
  return `
<div class="channel-block">
  <div class="channel-head">
    <div class="channel-icon ch-leads">◎</div>
    <span class="channel-name">Leads Brought In — HubSpot</span>
    <div class="channel-status-row"><span class="badge tracker">${leads.total} total</span></div>
  </div>
  <div class="channel-body">
    <div class="metrics-grid col4" style="margin-bottom:14px;">
      <div class="metric-cell"><div class="metric-val">${leads.total}</div><div class="metric-label">Total leads</div></div>
      ${viaCells}
    </div>
    ${leads.rows.length ? `<div class="ad-table-wrap"><table class="mini-table"><thead><tr><th>Name</th><th>Email</th><th>Company</th><th>Via</th></tr></thead><tbody>${rows}</tbody></table></div>${leads.rows.length > 25 ? `<p class="empty-note">+ ${leads.rows.length - 25} more</p>` : ''}` : '<p class="empty-note">No leads pulled for this week.</p>'}
  </div>
</div>`
}

function renderAdSpend(ad: { total: number; rows: AdSpendRow[] }): string {
  const rows = ad.rows.map(r => `
    <tr><td>${esc(r.platform)}</td><td>${esc(r.campaign || '—')}</td><td>${money(r.spend)}</td><td>${r.leads ?? '—'}</td><td>${esc(r.notes || '')}</td></tr>`).join('')
  return `
<div class="channel-block">
  <div class="channel-head">
    <div class="channel-icon ch-ads">$</div>
    <span class="channel-name">Ads Spend & Data</span>
    <div class="channel-status-row"><span class="badge wip">${money(ad.total)} spent</span></div>
  </div>
  <div class="channel-body">
    <div class="metrics-grid col2" style="margin-bottom:14px;">
      <div class="metric-cell"><div class="metric-val amber">${money(ad.total)}</div><div class="metric-label">Total ad spend</div></div>
      <div class="metric-cell"><div class="metric-val">${ad.rows.reduce((s, r) => s + (r.leads || 0), 0)}</div><div class="metric-label">Leads from ads (entered)</div></div>
    </div>
    ${ad.rows.length ? `<div class="ad-table-wrap"><table class="mini-table"><thead><tr><th>Platform</th><th>Campaign</th><th>Spend</th><th>Leads</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty-note">No ad-spend entries for this week — add them on the Weekly Report page (no ads-platform integration exists, so this is entered manually).</p>'}
  </div>
</div>`
}

function renderEmails(em: { total: number; rows: EmailCampaignRow[] }): string {
  const rows = em.rows.slice(0, 20).map(r => `
    <tr><td>${esc(r.name)}</td><td class="val-hi">${r.sent}</td><td>${r.opens}</td><td>${r.replies}</td></tr>`).join('')
  return `
<div class="channel-block">
  <div class="channel-head">
    <div class="channel-icon ch-email">✉</div>
    <span class="channel-name">Emails Sent — Instantly</span>
    <div class="channel-status-row"><span class="badge done">${em.total.toLocaleString()} sent</span></div>
  </div>
  <div class="channel-body">
    <div class="metrics-grid col3" style="margin-bottom:14px;">
      <div class="metric-cell"><div class="metric-val green">${em.total.toLocaleString()}</div><div class="metric-label">Total emails sent</div></div>
      <div class="metric-cell"><div class="metric-val">${em.rows.reduce((s, r) => s + r.opens, 0).toLocaleString()}</div><div class="metric-label">Unique opens</div></div>
      <div class="metric-cell"><div class="metric-val">${em.rows.reduce((s, r) => s + r.replies, 0).toLocaleString()}</div><div class="metric-label">Unique replies</div></div>
    </div>
    ${em.rows.length ? `<div class="ad-table-wrap"><table class="mini-table"><thead><tr><th>Campaign</th><th>Sent</th><th>Opens</th><th>Replies</th></tr></thead><tbody>${rows}</tbody></table></div>${em.rows.length > 20 ? `<p class="empty-note">+ ${em.rows.length - 20} more campaigns</p>` : ''}` : '<p class="empty-note">No campaign activity for this week.</p>'}
  </div>
</div>`
}

export function buildReportHtml(data: ReportData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GSI Marketing Report — ${esc(data.weekLabel)}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,500&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet">
<style>${STYLE}</style>
</head>
<body>
<div class="topbar">
  <div class="topbar-left">
    <div class="logo-mark">L</div>
    <div>
      <div class="report-title">GSI & Partner Marketing</div>
      <div class="report-sub">Weekly Report · Lyzr AI</div>
    </div>
  </div>
</div>
<div class="main">
${renderPipelineWidget(data.pipeline)}
<div id="current" class="week-header">
  <span class="week-badge current"><span class="week-dot"></span>${esc(data.weekLabel)}</span>
  <h2 class="week-title">${esc(data.weekStartLabel)} – ${esc(data.weekEndLabel)}</h2>
  <span class="week-dates">This week</span>
</div>
${renderDone(data.doneItems)}
${renderLeads(data.leads)}
${renderAdSpend(data.adSpend)}
${renderEmails(data.emails)}
<div style="margin-top:60px;padding-top:20px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
  <span style="font-size:11.5px;color:var(--text-3);">Lyzr AI · GSI &amp; Partner Marketing · Week of ${esc(data.weekStartLabel)}</span>
  <span style="font-size:11px;color:var(--text-3);">Generated ${esc(data.generatedLabel)} · Pipeline synced from HubSpot</span>
</div>
</div>
</body>
</html>`
}
