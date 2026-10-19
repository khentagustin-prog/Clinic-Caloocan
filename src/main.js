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
const toRow=p=>({id:p.id,name:p.name,type:p.type,lat:p.lat,lng:p.lng,d:p.distance_m,eta:p.eta_min,phone:p.phone,addr:p.address,hours:p.hours,er:p.emergency});

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
  const nav=`https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}`;
  return `<div class="item ${r.id===activeId?"active":""}" data-id="${r.id}" tabindex="0">
    <div class="meta"><span class="tag t-${r.type}">${T.lbl}</span>${r.er?"<span>🚑 May ER</span>":""}<span class="dist">${fmt(r.d)}</span></div>
    <h3>${esc(r.name)}</h3>
    <div class="meta">${r.addr?"📍 "+esc(r.addr):""}${r.hours?" · 🕒 "+esc(r.hours):""}</div>
    <div class="links"><a class="go" href="${nav}" target="_blank" rel="noopener">➤ Directions</a>${r.phone?`<a href="tel:${esc(r.phone.replace(/[^+\d]/g,""))}">📞 ${esc(r.phone)}</a>`:""}</div>
  </div>`;
}
function select(id,pan=true){
  activeId=id;const r=results.find(x=>x.id===id);if(!r) return;
  document.querySelectorAll(".item").forEach(e=>e.classList.toggle("active",e.dataset.id===id));
  document.querySelector(`.item[data-id="${id}"]`)?.scrollIntoView({block:"nearest",behavior:"smooth"});
  if(pan){map.setView([r.lat,r.lng],16);r.m?.openPopup()}
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
        <a class="call" href="${esc(h.directions)}" target="_blank" rel="noopener">➤ Pumunta rito (Directions)</a>
        ${c911}
        ${alt?`<div class="notice"><strong>Iba pang malapit:</strong><ul style="margin:6px 0 0 18px">${alt}</ul></div>`:""}${closeBtn}`;
      map.setView([h.lat,h.lng],15);
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
$("list").onclick=e=>{if(e.target.closest("a")) return;const i=e.target.closest(".item");if(i) select(i.dataset.id)};
$("list").onkeydown=e=>{if(e.key==="Enter"){const i=e.target.closest(".item");if(i) select(i.dataset.id)}};
