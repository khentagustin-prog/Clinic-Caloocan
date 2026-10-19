import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";

/* ====== CONFIG ====== */
// n8n webhooks (public). Walang API key dito — ligtas sa browser.
const N8N = (import.meta.env.VITE_N8N_BASE || "https://n8n.n8nserverhome.dpdns.org") + "/webhook";
const CALOOCAN = {lat:14.6507, lng:120.9672};

/* ====== STATE ====== */
let me=null, results=[], filter="all", watchId=null, activeId=null;
const $=id=>document.getElementById(id);
const TYPES={hospital:{lbl:"Ospital",c:"#2563eb",e:"🏥"},clinic:{lbl:"Klinika",c:"#0f766e",e:"🩺"},birth:{lbl:"Paanakan",c:"#db2777",e:"🤱"},rabies:{lbl:"Anti-rabies",c:"#d97706",e:"🐕"}};

/* ====== MAP ====== */
const map=L.map("map",{zoomControl:true}).setView([CALOOCAN.lat,CALOOCAN.lng],13);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(map);
const layer=L.layerGroup().addTo(map);
let meMarker=null, meCircle=null;

/* ====== HELPERS ====== */
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function dist(a,b,c,d){const R=6371e3,r=x=>x*Math.PI/180,dl=r(c-a),dn=r(d-b);
  const h=Math.sin(dl/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
const fmt=m=>m<1000?Math.round(m)+" m":(m/1000).toFixed(1)+" km";
function setStatus(t){$("status").textContent=t}
function classify(t){
  const n=(t.name||"")+" "+(t["name:en"]||"")+" "+(t.description||"");
  if(/rabies|animal bite|abtc|anti-?rabies/i.test(n)||t["healthcare:speciality"]==="animal_bite") return "rabies";
  if(t.healthcare==="birth_centre"||/lying[- ]?in|maternity|paanakan|birthing|midwi/i.test(n)) return "birth";
  if(t.amenity==="hospital"||t.healthcare==="hospital") return "hospital";
  return "clinic";
}
function getPos(){return new Promise((res,rej)=>{
  if(!navigator.geolocation) return rej(new Error("no-geo"));
  navigator.geolocation.getCurrentPosition(p=>res({lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy}),rej,{enableHighAccuracy:true,timeout:12000,maximumAge:15000});
})}

/* ====== LOCATION ====== */
async function locate(){
  try{ me=await getPos(); }
  catch(e){
    me={...CALOOCAN,acc:0,fallback:true};
    setStatus("Hindi makuha ang lokasyon mo — gamit ang gitna ng Caloocan. I-allow ang location sa browser para mas tumpak.");
  }
  drawMe(); startWatch();
  $("live").classList.toggle("on",!me.fallback);
  $("liveTxt").textContent=me.fallback?"Default: Caloocan":"Live na lokasyon";
}
function drawMe(){
  const ll=[me.lat,me.lng];
  if(!meMarker){
    meMarker=L.marker(ll,{icon:L.divIcon({className:"",html:'<div class="me" style="width:18px;height:18px"></div>',iconSize:[18,18],iconAnchor:[9,9]}),zIndexOffset:1000}).addTo(map).bindTooltip("Ikaw ay nandito");
    meCircle=L.circle(ll,{radius:me.acc||0,color:"#2563eb",weight:1,fillOpacity:.08}).addTo(map);
  }else{meMarker.setLatLng(ll);meCircle.setLatLng(ll).setRadius(me.acc||0)}
}
function startWatch(){
  if(watchId!==null||!navigator.geolocation||me.fallback) return;
  watchId=navigator.geolocation.watchPosition(p=>{
    const moved=dist(me.lat,me.lng,p.coords.latitude,p.coords.longitude);
    me={lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy};
    drawMe();
    if(cur&&!routing&&routeFrom&&Date.now()-routeFrom.t>12000&&dist(routeFrom.lat,routeFrom.lng,me.lat,me.lng)>60) route(cur,true); // live reroute
    if(moved>50&&results.length){results.forEach(r=>r.d=dist(me.lat,me.lng,r.lat,r.lng));render(false)} // live distance update
  },()=>{},{enableHighAccuracy:true,maximumAge:10000});
}

/* ====== n8n BACKEND ====== */
async function n8n(path,payload){
  const ctl=new AbortController(),to=setTimeout(()=>ctl.abort(),90000);
  try{
    const r=await fetch(`${N8N}/${path}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),signal:ctl.signal});
    if(!r.ok) throw new Error("HTTP "+r.status);
    const j=await r.json(); if(!j.ok) throw new Error(j.error||"error"); return j;
  }finally{clearTimeout(to)}
}
const toRow=p=>({id:p.id,name:p.name,type:p.type,lat:p.lat,lng:p.lng,d:p.distance_m,eta:p.eta_min,phone:p.phone,addr:p.address,hours:p.hours,er:p.emergency,website:p.website});

async function search(){
  const b=$("btnSearch");b.disabled=true;b.classList.add("searching");$("searchLbl").textContent="Hinahanap…";
  $("list").innerHTML='<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
  setStatus("Kinukuha ang lokasyon mo…");
  try{
    await locate();
    setStatus("Naghahanap sa database ng Caloocan…");
    const j=await n8n("caloocan-search",{mode:"search",lat:me.lat,lng:me.lng,radius:+$("radius").value});
    results=j.places.map(toRow);
    render(true);
    setStatus(results.length?`${results.length} pasilidad ang nahanap (${j.total} sa buong Caloocan).`:"Walang nahanap sa saklaw na ito. Subukan ang mas malaking km.");
  }catch(e){
    $("list").innerHTML='<div class="empty">May problema sa pagkuha ng datos. Subukan ulit mamaya.</div>';
    setStatus("Hindi makakonekta sa n8n server.");
  }finally{b.disabled=false;b.classList.remove("searching");$("searchLbl").textContent="Hanapin ulit"}
}

/* ====== RENDER ====== */
function render(fit){
  const rows=results.filter(r=>filter==="all"||r.type===filter);
  layer.clearLayers();
  const pts=[[me.lat,me.lng]];
  rows.forEach(r=>{
    const T=TYPES[r.type];
    const m=L.marker([r.lat,r.lng],{icon:L.divIcon({className:"",html:`<div class="pin" style="background:${T.c}"><span>${T.e}</span></div>`,iconSize:[30,30],iconAnchor:[15,30]})}).addTo(layer);
    m.bindPopup(`<strong>${esc(r.name)}</strong><br>${T.lbl} · ${fmt(r.d)}`);
    m.on("click",()=>select(r.id,false)); r.m=m; pts.push([r.lat,r.lng]);
  });
  $("list").innerHTML=rows.length?rows.map(card).join(""):'<div class="empty">Walang pasilidad sa kategoryang ito.</div>';
  if(fit&&pts.length>1) map.fitBounds(pts,{padding:[40,40],maxZoom:16});
  else if(fit) map.setView([me.lat,me.lng],14);
}
function card(r){
  const T=TYPES[r.type];
  return `<div class="item ${r.id===activeId?"active":""}" data-id="${r.id}" tabindex="0">
    <div class="meta"><span class="tag t-${r.type}">${T.lbl}</span>${r.er?"<span>🚑 May ER</span>":""}<span class="dist">${fmt(r.d)}</span></div>
    <h3>${esc(r.name)}</h3>
    <div class="meta">${r.addr?"📍 "+esc(r.addr):""}${r.hours?" · 🕒 "+esc(r.hours):""}</div>
    <div class="links"><a class="go" href="#" data-route="${r.id}">➤ Direksyon</a>${r.phone?`<a href="tel:${esc(r.phone.replace(/[^+\d]/g,""))}">📞 ${esc(r.phone)}</a>`:""}</div>
  </div>`;
}
function select(id,pan=true){
  activeId=id;const r=results.find(x=>x.id===id);if(!r) return;
  document.querySelectorAll(".item").forEach(e=>e.classList.toggle("active",e.dataset.id===id));
  document.querySelector(`.item[data-id="${id}"]`)?.scrollIntoView({block:"nearest",behavior:"smooth"});
  if(pan){map.setView([r.lat,r.lng],16);r.m?.openPopup()}
}

/* ====== DETAIL + ROUTE (sa loob ng website, OSRM) ====== */
const routeLayer=L.layerGroup().addTo(map);
let cur=null, profile="driving";
const MOD={left:"kaliwa",right:"kanan","slight left":"bahagyang kaliwa","slight right":"bahagyang kanan","sharp left":"matalim na kaliwa","sharp right":"matalim na kanan",straight:"diretso",uturn:"mag-U-turn"};
const fmtMin=s=>{const m=Math.max(1,Math.round(s/60));return m<60?m+" min":Math.floor(m/60)+" oras "+(m%60)+" min"};
function stepText(s){
  const m=s.maneuver,n=s.name?` sa ${esc(s.name)}`:"",d=MOD[m.modifier]||"";
  if(m.type==="depart") return `Magsimula${n}${d&&d!=="diretso"?" papuntang "+d:""}`;
  if(m.type==="arrive") return "Nakarating ka na sa destinasyon";
  if(m.type==="roundabout"||m.type==="rotary") return `Pumasok sa rotonda${n}`;
  if(m.type==="merge") return `Sumama sa daan${n}`;
  if(m.type==="continue"||m.modifier==="straight") return `Dumiretso${n}`;
  const verb=d.includes("kanan")?"Kumanan":d.includes("kaliwa")?"Kumaliwa":d==="mag-U-turn"?"Mag-U-turn":"Lumiko";
  return `${verb}${n}`;
}
function openDetail(id,withRoute){
  const r=results.find(x=>x.id===id);if(!r) return;
  cur=r;select(id);
  const T=TYPES[r.type];
  const web=r.website&&/^https?:\/\//.test(r.website)?r.website:"";
  $("list").hidden=true;const d=$("detail");d.hidden=false;
  d.innerHTML=`<button class="back" id="back">← Bumalik sa listahan</button>
    <div class="meta"><span class="tag t-${r.type}">${T.lbl}</span>${r.er?"<span>🚑 May emergency room</span>":""}</div>
    <h2>${esc(r.name)}</h2>
    <div class="facts">
      <div>📏 <span>${fmt(r.d)} (tuwid na linya) mula sa iyo</span></div>
      ${r.addr?`<div>📍 <span>${esc(r.addr)}, Caloocan</span></div>`:""}
      <div>🕒 <span>${r.hours?esc(r.hours):"Walang naka-lista na oras — tumawag muna"}</span></div>
      <div>📞 <span>${r.phone?`<a href="tel:${esc(r.phone.replace(/[^+\d]/g,""))}">${esc(r.phone)}</a>`:"Walang naka-lista na numero"}</span></div>
      ${web?`<div>🌐 <a href="${esc(web)}" target="_blank" rel="noopener">${esc(web.replace(/^https?:\/\/(www\.)?/,""))}</a></div>`:""}
      <div>🧭 <span>${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}</span></div>
    </div>
    <div class="mode" role="group" aria-label="Paraan ng biyahe">
      <button data-p="driving" aria-pressed="${profile==="driving"}">🚗 Sasakyan</button>
      <button data-p="foot" aria-pressed="${profile==="foot"}">🚶 Lakad</button>
    </div>
    <button class="btn search" id="goRoute">➤ Ipakita ang ruta sa mapa</button>
    <div id="routeOut"></div>`;
  $("back").onclick=closeDetail;
  $("goRoute").onclick=()=>route(r);
  d.querySelectorAll(".mode button").forEach(b=>b.onclick=()=>{profile=b.dataset.p;d.querySelectorAll(".mode button").forEach(x=>x.setAttribute("aria-pressed",x===b));route(r)});
  map.setView([r.lat,r.lng],16);
  route(r);
}
function closeDetail(){cur=null;routeLayer.clearLayers();$("detail").hidden=true;$("list").hidden=false;if(results.length) render(true)}
let routeSeq=0, routeFrom=null, routing=false;
const bearing=(a,b)=>{const r=x=>x*Math.PI/180,y=Math.sin(r(b[0]-a[0]))*Math.cos(r(b[1])),x=Math.cos(r(a[1]))*Math.sin(r(b[1]))-Math.sin(r(a[1]))*Math.cos(r(b[1]))*Math.cos(r(b[0]-a[0]));return (Math.atan2(y,x)*180/Math.PI+360)%360};
function arrows(coords){          // mga arrow na nakaturo sa direksyon ng biyahe, pantay ang pagitan
  let total=0;const segs=[];
  for(let i=1;i<coords.length;i++){const d=dist(coords[i-1][1],coords[i-1][0],coords[i][1],coords[i][0]);segs.push(d);total+=d}
  const gap=Math.max(90,total/24);let next=gap/2,run=0;
  for(let i=0;i<segs.length;i++){
    while(run+segs[i]>=next&&segs[i]>0){
      const t=(next-run)/segs[i],p=[coords[i][0]+(coords[i+1][0]-coords[i][0])*t,coords[i][1]+(coords[i+1][1]-coords[i][1])*t];
      L.marker([p[1],p[0]],{interactive:false,keyboard:false,icon:L.divIcon({className:"",iconSize:[16,16],iconAnchor:[8,8],
        html:`<div class="arrow" style="transform:rotate(${bearing(coords[i],coords[i+1]).toFixed(0)}deg)"></div>`})}).addTo(routeLayer);
      next+=gap;
    }
    run+=segs[i];
  }
}
function drawRoute(geo,approx){
  routeLayer.clearLayers();
  let line;
  if(approx){
    line=L.geoJSON(geo,{style:{color:"#6b7280",weight:5,opacity:.9,dashArray:"8 10",lineCap:"round"}}).addTo(routeLayer);
  }else{
    L.geoJSON(geo,{style:{color:"#fff",weight:13,opacity:1,lineCap:"round",lineJoin:"round"}}).addTo(routeLayer);       // outline
    line=L.geoJSON(geo,{style:{color:"#00b14f",weight:8,opacity:1,lineCap:"round",lineJoin:"round"}}).addTo(routeLayer);  // linya
    L.geoJSON(geo,{style:{color:"#fff",weight:3,opacity:.85,dashArray:"1 16",lineCap:"round",className:"route-flow"}}).addTo(routeLayer); // gumagalaw na daloy
    arrows(geo.coordinates);
  }
  const T=TYPES[cur.type];
  L.marker([cur.lat,cur.lng],{zIndexOffset:900,icon:L.divIcon({className:"",iconSize:[34,34],iconAnchor:[17,34],
    html:`<div class="pin" style="background:${T.c};width:34px;height:34px"><span>${T.e}</span></div>`})}).addTo(routeLayer).bindTooltip(cur.name,{direction:"top",offset:[0,-30]});
  return line;
}
async function route(r,silent=false){
  const out=$("routeOut"),seq=++routeSeq;routing=true;routeFrom={lat:me.lat,lng:me.lng,t:Date.now()};
  if(!silent){
    // agad na guhit (putol-putol na tuwid) habang kinukuha ang tunay na ruta
    drawRoute({type:"LineString",coordinates:[[me.lng,me.lat],[r.lng,r.lat]]},true);
    map.fitBounds([[me.lat,me.lng],[r.lat,r.lng]],{padding:[50,50]});
    out.innerHTML='<div class="notice">Kinukuha ang pinakamagandang ruta…</div>';
  }
  try{
    const j=await n8n("caloocan-route",{mode:"route",from:{lat:me.lat,lng:me.lng},to:{lat:r.lat,lng:r.lng},profile});
    if(seq!==routeSeq||!cur) return;                       // may mas bago nang request
    const line=drawRoute(j.geometry,j.approx);
    if(!silent) map.fitBounds(line.getBounds(),{padding:[50,50]});
    const warn=j.approx?'<div class="notice bad">⚠️ Hindi makuha ang tunay na daan ngayon — tuwid na linya lang ito at tantiya lamang.</div>':"";
    out.innerHTML=`${warn}<div class="routebox"><div class="sum"><span>${fmtMin(j.duration_s)}<small>${profile==="foot"?"lakad":"may traffic (tantiya)"}</small></span><span>${fmt(j.distance_m)}<small>layo sa kalsada</small></span></div>
      <ol class="steps">${j.steps.map(s=>`<li><span>${stepText({maneuver:{type:s.type,modifier:s.modifier},name:s.name})}</span><small>${s.distance_m&&s.type!=="arrive"?fmt(s.distance_m):""}</small></li>`).join("")}</ol></div>`;
  }catch(e){
    if(seq===routeSeq&&!silent) out.innerHTML='<div class="notice bad">Hindi makuha ang ruta ngayon. <button class="back" id="retryRoute">Subukan ulit</button></div>';
    $("retryRoute")&&($("retryRoute").onclick=()=>route(r));
  }finally{if(seq===routeSeq) routing=false}
}

/* ====== EMERGENCY (n8n bot) ====== */
async function urgent(){
  const b=$("btnUrgent");b.disabled=true;
  const dlg=$("dlg"),body=$("dlgBody");
  const closeBtn='<button class="close" id="dlgClose">Isara</button>';
  const c911='<a class="call" style="background:#111" href="tel:911">📞 Tumawag sa 911</a>';
  body.innerHTML='<div class="notice">Hinahanap ang pinakamalapit na ospital at ipinapaalam sa bot…</div>';dlg.showModal();
  try{
    await locate();
    const j=await n8n("caloocan-urgent",{mode:"urgent",lat:me.lat,lng:me.lng,accuracy:me.acc,approximate:!!me.fallback});
    const h=j.nearest;
    if(!h){body.innerHTML=`<div class="notice bad">Walang nahanap na ospital. Tumawag sa <strong>911</strong>.</div>${c911}${closeBtn}`}
    else{
      const alt=j.alternatives.map(a=>`<li>${esc(a.name)} — ${fmt(a.distance_m)}</li>`).join("");
      body.innerHTML=`<div class="big">${esc(h.name)}</div>
        <div>📏 ${fmt(h.distance_m)} · 🚗 ~${h.eta_min} min ${h.phone?"· 📞 "+esc(h.phone):""}</div>
        <div class="notice ok">✅ Naipaalam na sa bot ang lokasyon mo at ang ospital.</div>
        <button class="call" id="goHere" style="width:100%;border:0;font:inherit;cursor:pointer">➤ Ipakita ang ruta sa mapa</button>
        ${c911}
        ${alt?`<div class="notice"><strong>Iba pang malapit:</strong><ul style="margin:6px 0 0 18px">${alt}</ul></div>`:""}${closeBtn}`;
      results=[h,...j.alternatives].map(toRow);render(false);
      $("goHere").onclick=()=>{dlg.close();openDetail(results[0].id,true)};
    }
  }catch(e){
    body.innerHTML=`<div class="notice bad">Hindi maabot ang bot. Tumawag agad sa <strong>911</strong>.</div>${c911}${closeBtn}`;
  }finally{b.disabled=false;$("dlgClose").onclick=()=>dlg.close()}
}

/* ====== EVENTS ====== */
$("btnSearch").onclick=search;
$("btnUrgent").onclick=urgent;
$("radius").onchange=()=>me&&search();
$("chips").onclick=e=>{const c=e.target.closest(".chip");if(!c) return;
  filter=c.dataset.f;document.querySelectorAll(".chip").forEach(x=>x.setAttribute("aria-pressed",x===c));
  if(results.length) render(true)};
$("list").onclick=e=>{
  const rb=e.target.closest("[data-route]");if(rb){e.preventDefault();return openDetail(rb.dataset.route,true)}
  if(e.target.closest("a")) return;const i=e.target.closest(".item");if(i) openDetail(i.dataset.id,false)};
$("list").onkeydown=e=>{if(e.key==="Enter"){const i=e.target.closest(".item");if(i) openDetail(i.dataset.id,false)}};
