const KEY="frances-personal-v2";
const DB_NAME="frances-personal-db";
const DB_VERSION=1;
const DB_STORE="app";
const DB_DATA_KEY="library";
const DB_META_KEY="meta";
const SYNC_CONFIG_KEY="frances-personal-sync-config";
const SYNC_STATE_KEY="frances-personal-sync-state";
const APP_VERSION="v1.7";
let syncConfig=null;
let syncClient=null;
let syncUser=null;
let syncBusy=false;

const sample=[
 {id:1,es:"Hola, ¿cómo estás?",fr:"Bonjour, comment ça va ?",level:"A1",tags:["Conversación","Saludos"],pronunciationStars:2,translationStars:2},
 {id:2,es:"Quisiera un café, por favor.",fr:"Je voudrais un café, s'il vous plaît.",level:"A1",tags:["Restaurante","Peticiones"],pronunciationStars:1,translationStars:2},
 {id:3,es:"Ayer fui al supermercado.",fr:"Hier, je suis allé au supermarché.",level:"A2",tags:["Compras","Pasado"],pronunciationStars:3,translationStars:1},
 {id:4,es:"Aunque estaba cansado, decidí salir.",fr:"Même si j'étais fatigué, j'ai décidé de sortir.",level:"B1",tags:["Conversación","Pasado"],pronunciationStars:2,translationStars:2},
 {id:5,es:"Si tuviera más tiempo, viajaría por Francia.",fr:"Si j'avais plus de temps, je voyagerais en France.",level:"B2",tags:["Viajes","Condicional"],pronunciationStars:1,translationStars:1},
 {id:6,es:"Es importante que encontremos una solución.",fr:"Il est important que nous trouvions une solution.",level:"C1",tags:["Opiniones","Trabajo"],pronunciationStars:3,translationStars:2},
 {id:7,es:"A pesar de las dificultades, el proyecto siguió adelante.",fr:"Malgré les difficultés, le projet a continué.",level:"C2",tags:["Trabajo","Expresiones"],pronunciationStars:2,translationStars:1}
];

const levels=["A1","A2","B1","B2","C1","C2"];
let data=sample.map(migratePhrase);

let streakData={
 current:0,
 best:0,
 lastDate:null
};

loadStreak();

let dbReady=false;
let saveTimer=null;

function loadStreak(){
 try{
  const saved=JSON.parse(localStorage.getItem("frances-streak"));
  if(saved && typeof saved==="object"){
   streakData={
    current:Number(saved.current)||0,
    best:Number(saved.best)||0,
    lastDate:saved.lastDate||null
   };
  }
 }catch(e){
  console.warn("No se pudo cargar la racha:",e);
 }
}

function saveStreak(){
 try{
  localStorage.setItem("frances-streak",JSON.stringify(streakData));
 }catch(e){
  console.warn("No se pudo guardar la racha:",e);
 }
}

function getTodayKey(){
 const d=new Date();
 const y=d.getFullYear();
 const m=String(d.getMonth()+1).padStart(2,"0");
 const day=String(d.getDate()).padStart(2,"0");
 return `${y}-${m}-${day}`;
}

function getYesterdayKey(){
 const d=new Date();
 d.setDate(d.getDate()-1);
 const y=d.getFullYear();
 const m=String(d.getMonth()+1).padStart(2,"0");
 const day=String(d.getDate()).padStart(2,"0");
 return `${y}-${m}-${day}`;
}

function registerStudyDay(){
 const today=getTodayKey();

 if(streakData.lastDate===today)return;

 if(streakData.lastDate===getYesterdayKey()){
  streakData.current++;
 }else{
  streakData.current=1;
 }

 streakData.best=Math.max(
  streakData.best,
  streakData.current
 );

 streakData.lastDate=today;
 saveStreak();
}

let current=0;
let currentLevel=null;
let currentPart=1;
let sessionType=null;
let sessionIds=[];

let partAudioPlaying=false;
let partAudioItems=[];
let partAudioIndex=0;
let partAudioTimer=null;
let sessionPos=0;
let sessionChecked=false;
let sessionPracticedIds=new Set();
let selectedTag="Todas";
let libraryQuery="";
let localUpdatedAt=0;

function normalize(value){
 return String(value ?? "")
   .normalize("NFD")
   .replace(/[\u0300-\u036f]/g,"")
   .toLowerCase()
   .replace(/[’‘]/g,"'")
   .replace(/[¿?¡!.,;:()[\]{}"“”]/g," ")
   .replace(/\s+/g," ")
   .trim();
}

function masteryPercent(arr, key){
 if(!arr.length)return null;
 const avg=arr.reduce((sum,x)=>sum+(Number(x[key])||0),0)/arr.length;
 return Math.round(((avg-1)/4)*100);
}

function masteryLabel(arr,key){
 const pct=masteryPercent(arr,key);
 return pct===null?"—":pct+"%";
}

function migratePhrase(x){
 return {
  ...x,
  id:x.id||Date.now()+Math.random(),
  tags:Array.isArray(x.tags)?x.tags:[],
  level:levels.includes(x.level)?x.level:"A1",
  part:[1,2,3,4].includes(Number(x.part))?Number(x.part):1,
  pronunciationStars:Number(x.pronunciationStars ?? x.stars) || 1,
  translationStars:Number(x.translationStars ?? x.stars) || 1,
  practiceCount:Number(x.practiceCount)||0,
  lastPracticed:x.lastPracticed||null
 };
}

function openDB(){
 return new Promise((resolve,reject)=>{
  if(!("indexedDB" in window)){reject(new Error("IndexedDB no disponible"));return}
  const req=indexedDB.open(DB_NAME,DB_VERSION);
  req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(DB_STORE))req.result.createObjectStore(DB_STORE)};
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||new Error("No se pudo abrir la base de datos"));
 });
}

async function dbGet(key){
 const db=await openDB();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(DB_STORE,"readonly"), req=tx.objectStore(DB_STORE).get(key);
  req.onsuccess=()=>resolve(req.result??null); req.onerror=()=>reject(req.error);
  tx.oncomplete=()=>db.close(); tx.onerror=()=>reject(tx.error);
 });
}

async function dbSet(key,value){
 const db=await openDB();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(DB_STORE,"readwrite"); tx.objectStore(DB_STORE).put(value,key);
  tx.oncomplete=()=>{db.close();resolve()}; tx.onerror=()=>{db.close();reject(tx.error)};
 });
}

function save(){
 if(saveTimer)clearTimeout(saveTimer);
 localUpdatedAt=Date.now();
 saveTimer=setTimeout(async()=>{
  try{await dbSet(DB_DATA_KEY,data);await dbSet(DB_META_KEY,{updatedAt:localUpdatedAt});dbReady=true;setDataStatus(syncUser?"Guardado localmente · pendiente de sincronizar":"Guardado localmente");}
  catch(e){localStorage.setItem(KEY,JSON.stringify(data));setDataStatus("Copia local de emergencia");}
  if(syncUser) syncPush();
 },80);
}

function setDataStatus(text){
 const el=document.getElementById("dataStatus"); if(el)el.textContent=text;
}

async function loadData(){
 try{
  const stored=await dbGet(DB_DATA_KEY);
  if(Array.isArray(stored)){data=stored.map(migratePhrase);const meta=await dbGet(DB_META_KEY);localUpdatedAt=Number(meta?.updatedAt)||Date.now();dbReady=true;setDataStatus("Datos locales listos");return}
 }catch(e){}
 let legacy=null;
 try{legacy=JSON.parse(localStorage.getItem(KEY)||"null")||JSON.parse(localStorage.getItem("frances-personal-v1")||"null")}catch(e){}
 if(Array.isArray(legacy)&&legacy.length){data=legacy.map(migratePhrase);localUpdatedAt=Date.now();await dbSet(DB_DATA_KEY,data);await dbSet(DB_META_KEY,{updatedAt:localUpdatedAt});dbReady=true;setDataStatus("Datos migrados a la nueva base local");return}
 data=sample.map(migratePhrase);localUpdatedAt=Date.now();await dbSet(DB_DATA_KEY,data);await dbSet(DB_META_KEY,{updatedAt:localUpdatedAt});dbReady=true;setDataStatus("Datos locales listos");
}

function loadSyncConfig(){
 try{syncConfig=JSON.parse(localStorage.getItem(SYNC_CONFIG_KEY)||"null")}catch(e){syncConfig=null}
 return syncConfig;
}

function saveSyncConfig(cfg){syncConfig=cfg;localStorage.setItem(SYNC_CONFIG_KEY,JSON.stringify(cfg));}
function syncAvailable(){return !!(window.supabase&&syncConfig?.url&&syncConfig?.anonKey);}

function initSyncClient(){
 if(!syncAvailable())return null;
 try{syncClient=window.supabase.createClient(syncConfig.url,syncConfig.anonKey,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storage:window.localStorage}
  });return syncClient}catch(e){syncClient=null;return null}
}

async function syncInit(){
 loadSyncConfig();
 if(!syncAvailable())return;
 const c=initSyncClient(); if(!c)return;
 try{
  const {data:{session}}=await c.auth.getSession();
  syncUser=session?.user||null;
 }catch(e){syncUser=null}
 c.auth.onAuthStateChange((event,session)=>{
  syncUser=session?.user||null;
  updateSyncBadge();
  if(session && (event==="SIGNED_IN" || event==="INITIAL_SESSION")){
    setTimeout(()=>syncNow(),150);
  }
 });
 updateSyncBadge();
 if(syncUser){
  setTimeout(()=>syncNow(),150);
 }
}

function updateSyncBadge(){
 const el=document.getElementById("syncBadge");
 if(!el)return;
 el.textContent=!syncConfig?"No configurado":(syncUser?`☁️ ${syncUser.email}`:"☁️ Sin sesión");
}

function openSync(){
 loadSyncConfig();
 document.getElementById("main").innerHTML=`
 <section>
  <div class="section-head"><div><h2>☁️ Sincronización</h2><div class="muted">Tus datos siguen guardados localmente. La nube es una copia sincronizada entre dispositivos.</div></div></div>
  <div class="card sync-card">
    <div id="syncBadge" class="sync-badge"></div>
    <h3>1. Conectar tu proyecto</h3>
    <p class="muted small">Usamos Supabase en su plan gratuito. Necesitas crear un proyecto y pegar aquí su URL y su clave pública (anon key). No pongas aquí una service_role key.</p>
    <label class="field-label">Project URL</label><input id="syncUrl" value="${escapeHtml(syncConfig?.url||"")}" placeholder="https://xxxxx.supabase.co">
    <label class="field-label">Anon public key</label><input id="syncKey" value="${escapeHtml(syncConfig?.anonKey||"")}" placeholder="eyJ..." autocomplete="off">
    <div class="actions"><button class="btn primary" onclick="saveAndConnectSync()">Guardar conexión</button><button class="btn" onclick="clearSyncConfig()">Desconectar proyecto</button></div>
    <h3>2. Cuenta</h3>
    <p class="muted small">La cuenta permite que el mismo progreso esté disponible en tus dispositivos.</p>
    <label class="field-label">Email</label><input id="syncEmail" type="email" placeholder="tu@email.com" autocomplete="email">
    <label class="field-label">Contraseña</label><input id="syncPassword" type="password" placeholder="Mínimo 6 caracteres" autocomplete="current-password">
    <div class="actions"><button class="btn primary" onclick="syncSignUp()">Crear cuenta</button><button class="btn" onclick="syncSignIn()">Iniciar sesión</button><button class="btn" onclick="syncSignOut()">Cerrar sesión</button></div>
    <h3>3. Sincronizar</h3>
    <p class="muted small">Tu sesión queda guardada en este dispositivo. Una vez iniciada, la app la recupera automáticamente al volver a abrirla.</p>
    <div class="actions"><button class="btn primary" onclick="syncNow()">🔄 Sincronizar ahora</button><button class="btn" onclick="exportJSON()">⬇️ Copia JSON</button></div>
    <div id="syncMessage" class="feedback"></div>
  </div>
  <div class="card sync-card"><h3>Configuración de Supabase</h3><p class="muted small">En el ZIP encontrarás <b>supabase-setup.sql</b>. Se ejecuta una sola vez en el SQL Editor de tu proyecto.</p></div>
 </section>`;
 updateSyncBadge();
}

function syncMsg(t){const el=document.getElementById("syncMessage");if(el)el.textContent=t;setDataStatus(t)}

async function saveAndConnectSync(){
 const url=document.getElementById("syncUrl")?.value.trim().replace(/\/$/,"");
 const anonKey=document.getElementById("syncKey")?.value.trim();
 if(!url||!anonKey){alert("Introduce la URL y la anon key.");return}
 saveSyncConfig({url,anonKey});
 initSyncClient();
 if(!syncClient){alert("No se pudo inicializar Supabase. Revisa la URL y la clave.");return}
 try{const {data:{session}}=await syncClient.auth.getSession();syncUser=session?.user||null;syncMsg("Conexión guardada.");updateSyncBadge();}catch(e){syncMsg("Conexión guardada, pero no se pudo comprobar la sesión.")}
}

function clearSyncConfig(){
 if(!confirm("¿Desconectar la sincronización de este dispositivo? Tus datos locales NO se borrarán."))return;
 localStorage.removeItem(SYNC_CONFIG_KEY);syncConfig=null;syncClient=null;syncUser=null;updateSyncBadge();openSync();
}

async function ensureClient(){if(!syncConfig)loadSyncConfig();if(!syncClient)initSyncClient();return syncClient}

async function syncSignUp(){
 const c=await ensureClient(); if(!c){alert("Primero guarda la conexión.");return}
 const email=document.getElementById("syncEmail")?.value.trim(), password=document.getElementById("syncPassword")?.value;
 if(!email||!password){alert("Introduce email y contraseña.");return}
 syncMsg("Creando cuenta…");
 const {error}=await c.auth.signUp({email,password});
 if(error){syncMsg("Error: "+error.message);return}
 syncMsg("Cuenta creada. Si Supabase pide confirmar el email, revisa tu correo y después inicia sesión.");
}

async function syncSignIn(){
 const c=await ensureClient(); if(!c){alert("Primero guarda la conexión.");return}
 const email=document.getElementById("syncEmail")?.value.trim(), password=document.getElementById("syncPassword")?.value;
 if(!email||!password){alert("Introduce email y contraseña.");return}
 syncMsg("Iniciando sesión…");
 const {data,error}=await c.auth.signInWithPassword({email,password});
 if(error){syncMsg("Error: "+error.message);return}
 syncUser=data.user;updateSyncBadge();syncMsg("Sesión iniciada. Sincronizando…");await syncNow();
}

async function syncSignOut(){const c=await ensureClient();if(!c)return;await c.auth.signOut();syncUser=null;updateSyncBadge();syncMsg("Sesión cerrada. Tus datos locales siguen aquí.")}

async function syncPullRemote(){
 const c=await ensureClient();if(!c||!syncUser)throw new Error("No hay una sesión activa.");
 const {data:row,error}=await c.from("user_data").select("data,updated_at").eq("user_id",syncUser.id).maybeSingle();
 if(error)throw error;
 if(!row)return {exists:false};
 return {exists:true,data:row.data,updatedAt:new Date(row.updated_at).getTime()};
}

async function syncPush(){
 if(syncBusy||!syncUser)return;
 try{
  const c=await ensureClient();if(!c)return;
  syncBusy=true;
  const payload={phrases:data.map(migratePhrase),localUpdatedAt};
  const {error}=await c.from("user_data").upsert({user_id:syncUser.id,data:payload,updated_at:new Date(localUpdatedAt).toISOString()},{onConflict:"user_id"});
  if(error)throw error;
  setDataStatus("☁️ Sincronizado");
 }catch(e){setDataStatus("Guardado local · nube pendiente");}
 finally{syncBusy=false;}
}

async function syncNow(){
 const c=await ensureClient();
 if(!c||!syncUser){syncMsg("Primero configura Supabase e inicia sesión.");return}
 if(syncBusy){syncMsg("Ya hay una sincronización en curso.");return}
 syncBusy=true;
 try{
  syncMsg("Comparando datos…");
  const remote=await syncPullRemote();
  if(!remote.exists){
   const payload={phrases:data.map(migratePhrase),localUpdatedAt};
   const {error}=await c.from("user_data").upsert({user_id:syncUser.id,data:payload,updated_at:new Date(localUpdatedAt).toISOString()},{onConflict:"user_id"});
   if(error)throw error;
   syncMsg("☁️ Biblioteca subida por primera vez.");return;
  }
  if(remote.updatedAt>localUpdatedAt){
   const incoming=Array.isArray(remote.data?.phrases)?remote.data.phrases:null;
   if(incoming){data=incoming.map(migratePhrase);localUpdatedAt=remote.updatedAt;await dbSet(DB_DATA_KEY,data);await dbSet(DB_META_KEY,{updatedAt:localUpdatedAt});if(typeof renderCurrent==="function")renderCurrent();syncMsg("☁️ Datos descargados desde la nube.");return;}
  }
  if(localUpdatedAt>remote.updatedAt){
   const payload={phrases:data.map(migratePhrase),localUpdatedAt};
   const {error}=await c.from("user_data").upsert({user_id:syncUser.id,data:payload,updated_at:new Date(localUpdatedAt).toISOString()},{onConflict:"user_id"});
   if(error)throw error;
   syncMsg("☁️ Datos locales subidos a la nube.");return;
  }
  syncMsg("☁️ Todo está sincronizado.");
 }catch(e){syncMsg("Error de sincronización: "+(e.message||e))}
 finally{syncBusy=false}
}

function escapeHtml(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

function setNav(active){
 document.querySelectorAll(".navbtn").forEach(x=>x.classList.remove("active"));
 document.getElementById(active==="library"?"navLibrary":"navHome").classList.add("active");
}

function stars(n,id,type){
 let s='<div class="stars">';
 for(let i=1;i<=5;i++) s+=`<button class="star ${i<=n?"on":""}" onclick="rate(${JSON.stringify(id)},${i},'${type}')" aria-label="${type} ${i} estrellas">★</button>`;
 return s+"</div>";
}

function registerPhrasePractice(x){
 if(!x)return;
 const key=String(x.id);

 if(sessionType && sessionIds.length){
  if(sessionPracticedIds.has(key))return;
  sessionPracticedIds.add(key);
 }

 x.practiceCount=(Number(x.practiceCount)||0)+1;
 x.lastPracticed=new Date().toISOString();

 save();
}

window.rate=(id,n,type)=>{
 const x=data.find(a=>String(a.id)===String(id)); 
 if(!x)return;

 if(type==="pronunciation")x.pronunciationStars=n;
 if(type==="translation")x.translationStars=n;

 registerPhrasePractice(x);

 if(typeof renderCurrent==="function")renderCurrent();
};

function goHome(){
 currentLevel=null; sessionType=null; sessionIds=[]; sessionPos=0; setNav("home"); home();
}

function home(){
 const counts=Object.fromEntries(levels.map(l=>[l,data.filter(x=>x.level===l).length]));
 const total=data.length;
 document.getElementById("main").innerHTML=`
  <section>
  <div class="card" style="margin-bottom:16px">
 <div style="font-size:28px;font-weight:800">
  🔥 ${streakData.current}
 </div>
 <div><b>días de racha</b></div>
 <div class="muted small" style="margin-top:4px">
  Récord: ${streakData.best} días
 </div>
</div>
<div class="card" style="margin-bottom:16px">
 <div class="section-head" style="margin-bottom:10px">
  <div>
   <b>🎯 Repasar hoy</b>
   <div class="muted small">
    Practica las frases que más necesitan atención.
   </div>
  </div>
 </div>

 <div class="actions">
  <button class="btn primary" onclick="startReviewToday('translation')">
   ✍️ Traducción
  </button>

  <button class="btn" onclick="startReviewToday('pronunciation')">
   🎧 Pronunciación
  </button>
 </div>
</div>
   <div class="section-head">
    <div><h2>Elige tu nivel</h2><div class="muted">Empieza por A1 y avanza hasta C2.</div></div>
    <button class="btn" onclick="library()">📚 Gestionar frases</button>
   </div>
   <div class="level-grid">
    ${levels.map(l=>{
      const c=counts[l], pct=total?Math.min(100,c/Math.max(...Object.values(counts),1)*100):0;
      return `<button class="level-card" onclick="openLevel('${l}')">
       <div class="level-name">${l}</div>
       <div class="level-count">${c}${c===1?"frase":"frases"}</div>
       <div class="level-progress"><span style="width:${pct}%"></span></div>
       <div class="muted small" style="margin-top:12px">Entrar al nivel →</div>
      </button>`;
    }).join("")}
   </div>
  </section>`;
}

function openLevel(level){
 currentLevel=level; currentPart=null; setNav("home");
 const arr=data.filter(x=>x.level===level);
 const avgP=arr.length?(arr.reduce((a,x)=>a+x.pronunciationStars,0)/arr.length).toFixed(1):"—";
 const avgT=arr.length?(arr.reduce((a,x)=>a+x.translationStars,0)/arr.length).toFixed(1):"—";
 const parts=[1,2,3,4];
 document.getElementById("main").innerHTML=`
  <section>
   <div class="section-head">
    <div><button class="btn smallbtn" onclick="goHome()">← Niveles</button><h2 style="margin-top:10px">${level}</h2><div class="muted">${arr.length} ${arr.length===1?"frase":"frases"} en este nivel</div></div>
   </div>
   <div class="mastery-overview">
    <div class="mastery-card">
     <div class="mastery-head"><span>🎧 Dominio de pronunciación</span><b>${masteryLabel(arr,"pronunciationStars")}</b></div>
     <div class="mastery-bar"><span style="width:${masteryPercent(arr,"pronunciationStars")||0}%"></span></div>
     <div class="muted small">Basado en la media de estrellas · 5 ⭐ = 100%</div>
    </div>
    <div class="mastery-card">
     <div class="mastery-head"><span>✍️ Dominio de traducción</span><b>${masteryLabel(arr,"translationStars")}</b></div>
     <div class="mastery-bar"><span style="width:${masteryPercent(arr,"translationStars")||0}%"></span></div>
     <div class="muted small">Basado en la media de estrellas · 5 ⭐ = 100%</div>
    </div>
   </div>
   <div class="stats-grid">
    <div class="stat"><div class="muted small">Pronunciación media</div><b>⭐ ${avgP}</b></div>
    <div class="stat"><div class="muted small">Traducción media</div><b>⭐ ${avgT}</b></div>
    <div class="stat"><div class="muted small">Necesitan pronunciación</div><b>${arr.filter(x=>x.pronunciationStars<=2).length}</b></div>
    <div class="stat"><div class="muted small">Necesitan traducción</div><b>${arr.filter(x=>x.translationStars<=2).length}</b></div>
   </div>
   <div class="sub-library-grid">
    ${parts.map(part=>{
      const partArr=arr.filter(x=>Number(x.part)===part);
      const n=partArr.length;
      const pPct=masteryPercent(partArr,"pronunciationStars");
      const tPct=masteryPercent(partArr,"translationStars");
      return `<button class="sub-library-card" onclick="openPart('${level}',${part})">
       <div class="sub-library-name">${level} · Parte ${part}</div>
       <div class="sub-library-count">${n}${n===1?"frase":"frases"}</div>
       <div class="part-mastery">
        <div class="part-mastery-row"><span>🎧 Pronunciación</span><b>${pPct===null?"—":pPct+"%"}</b></div>
        <div class="part-progress"><span style="width:${pPct||0}%"></span></div>
        <div class="part-mastery-row"><span>✍️ Traducción</span><b>${tPct===null?"—":tPct+"%"}</b></div>
        <div class="part-progress"><span style="width:${tPct||0}%"></span></div>
       </div>
       <div class="muted small" style="margin-top:10px">Abrir biblioteca →</div>
      </button>`;
    }).join("")}
   </div>
   <div class="level-actions">
    <button class="btn" onclick="showLevelPhrases('${level}')">📖 Ver todas las frases</button>
   </div>
   <div id="levelContent"></div>
  </section>`;
}

function openPart(level,part){
 currentLevel=level; currentPart=part; setNav("home");
 const arr=data.filter(x=>x.level===level && Number(x.part)===Number(part));
 const avgP=arr.length?(arr.reduce((a,x)=>a+x.pronunciationStars,0)/arr.length).toFixed(1):"—";
 const avgT=arr.length?(arr.reduce((a,x)=>a+x.translationStars,0)/arr.length).toFixed(1):"—";
 const tags=[...new Set(arr.flatMap(x=>x.tags))].sort();
 document.getElementById("main").innerHTML=`
  <section>
   <div class="section-head">
    <div><button class="btn smallbtn" onclick="openLevel('${level}')">← ${level}</button><h2 style="margin-top:10px">${level} · Parte ${part}</h2><div class="muted">${arr.length} ${arr.length===1?"frase":"frases"} en esta biblioteca</div></div>
   </div>
   <div class="mastery-overview">
    <div class="mastery-card">
     <div class="mastery-head"><span>🎧 Dominio de pronunciación</span><b>${masteryLabel(arr,"pronunciationStars")}</b></div>
     <div class="mastery-bar"><span style="width:${masteryPercent(arr,"pronunciationStars")||0}%"></span></div>
     <div class="muted small">5 ⭐ = 100% de dominio</div>
    </div>
    <div class="mastery-card">
     <div class="mastery-head"><span>✍️ Dominio de traducción</span><b>${masteryLabel(arr,"translationStars")}</b></div>
     <div class="mastery-bar"><span style="width:${masteryPercent(arr,"translationStars")||0}%"></span></div>
     <div class="muted small">5 ⭐ = 100% de dominio</div>
    </div>
   </div>
   <div class="stats-grid">
    <div class="stat"><div class="muted small">Pronunciación media</div><b>⭐ ${avgP}</b></div>
    <div class="stat"><div class="muted small">Traducción media</div><b>⭐ ${avgT}</b></div>
    <div class="stat"><div class="muted small">Necesitan pronunciación</div><b>${arr.filter(x=>x.pronunciationStars<=2).length}</b></div>
    <div class="stat"><div class="muted small">Necesitan traducción</div><b>${arr.filter(x=>x.translationStars<=2).length}</b></div>
   </div>
  <div class="level-actions">
    <button class="btn primary" onclick="startSession('${level}','translation',${part})">✍️ Practicar traducción</button>
    <button class="btn" onclick="startSession('${level}','pronunciation',${part})">🎧 Practicar pronunciación</button>
    <button class="btn" onclick="showLevelPhrases('${level}','Todas',${part})">📖 Ver frases</button>
   </div>

   <div class="card" style="margin-top:16px">
    <div class="section-head" style="margin-bottom:10px">
     <div>
      <b>🎧 Escuchar toda la parte</b>
      <div class="muted small">
       Escucha todas las frases en francés automáticamente, sin tener que tocar la pantalla.
      </div>
     </div>
    </div>

    <div class="actions">
     <button class="btn primary" onclick="playPartAudio(data.filter(x=>x.level==='${level}' && Number(x.part)===${part}))">
      ▶️ Escuchar toda la parte
     </button>

     <button class="btn" onclick="stopPartAudio()">
      ⏹️ Parar
     </button>
    </div>

    <div id="speechStatus" class="muted small" style="margin-top:10px">
     🔊 Audio listo
    </div>
   </div>
   
   <div id="levelContent"></div>
  </section>`;
 if(tags.length || arr.length) showLevelPhrases(level,"Todas",part);
}

function showLevelPhrases(level,tag="Todas",part=null){
 const arr=data.filter(x=>x.level===level && (part===null || Number(x.part)===Number(part)) && (tag==="Todas"||x.tags.includes(tag)));
 const tags=[...new Set(arr.flatMap(x=>x.tags))].sort();
 const el=document.getElementById("levelContent");
 if(!el)return;
 el.innerHTML=`
  <div class="chips"><button class="chip ${tag==="Todas"?"active":""}" onclick="showLevelPhrases('${level}','Todas',${part===null?"null":part})">Todas</button>${tags.map(t=>`<button class="chip ${tag===t?"active":""}" onclick="showLevelPhrases('${level}',${JSON.stringify(t)},${part===null?"null":part})">${escapeHtml(t)}</button>`).join("")}</div>
  <div class="phrase-list">${arr.map(phraseRow).join("")||'<div class="empty">No hay frases con este filtro.</div>'}</div>`;
}

function phraseRow(x){
 return `<article class="phrase-row">
  <div class="muted small">${x.level} · Parte ${x.part||1}</div>
  <div>${escapeHtml(x.es)}</div>
  <div class="fr">${escapeHtml(x.fr)}</div>
  <div class="rating-line">
   <div class="rating-item"><span class="muted small">🎧 Pronunciación</span>${stars(x.pronunciationStars,x.id,"pronunciation")}</div>
   <div class="rating-item"><span class="muted small">✍️ Traducción</span>${stars(x.translationStars,x.id,"translation")}</div>
  </div>
  <div class="tags">${x.tags.map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
  <div class="actions" style="margin-top:10px"><button class="btn smallbtn" onclick="editPhrase(${JSON.stringify(x.id)})">Editar</button><button class="btn smallbtn" onclick="deletePhrase(${JSON.stringify(x.id)})">Eliminar</button></div>
 </article>`;
}

function startReviewToday(type){
 const now=Date.now();

 const sorted=[...data].sort((a,b)=>{
  const aStars=type==="translation"
    ?Number(a.translationStars)||1
    :Number(a.pronunciationStars)||1;

  const bStars=type==="translation"
    ?Number(b.translationStars)||1
    :Number(b.pronunciationStars)||1;

  const aPracticed=Number(a.practiceCount)||0;
  const bPracticed=Number(b.practiceCount)||0;

  const aLast=a.lastPracticed?new Date(a.lastPracticed).getTime():0;
  const bLast=b.lastPracticed?new Date(b.lastPracticed).getTime():0;

  const aWeak=(aPracticed>0 ? (6-aStars)*100 : 0);
  const bWeak=(bPracticed>0 ? (6-bStars)*100 : 0);

  const aAge=aLast ? Math.min((now-aLast)/86400000,30) : 0;
  const bAge=bLast ? Math.min((now-bLast)/86400000,30) : 0;

  const aNew=aPracticed===0?40:0;
  const bNew=bPracticed===0?40:0;

  const scoreA=aWeak+aAge+aNew;
  const scoreB=bWeak+bAge+bNew;

  return scoreB-scoreA || Math.random()-0.5;
 });

 const selected=sorted.slice(0,50);

 if(!selected.length){
  alert("Todavía no hay frases para repasar.");
  return;
 }
 sessionPracticedIds=new Set();

 currentLevel=null;
 currentPart=null;
 sessionType=type;
 sessionIds=selected.map(x=>x.id);

 renderSession();
}

function startSession(level,type,part=null){
 const pool=data.filter(x=>x.level===level && (part===null || Number(x.part)===Number(part)));
 if(!pool.length){alert("Todavía no hay frases en este nivel.");return}
 sessionPracticedIds=new Set();
 currentLevel=level;
 currentPart=part;
 sessionType=type;
 const sorted=[...pool].sort((a,b)=>{
  const ra=type==="translation"?a.translationStars:a.pronunciationStars;
  const rb=type==="translation"?b.translationStars:b.pronunciationStars;
  return ra-rb || Math.random()-0.5;
 });
 sessionIds=sorted.map(x=>x.id);
 renderSession();
}

function renderSession(){
 const arr=sessionIds.map(id=>data.find(x=>String(x.id)===String(id))).filter(Boolean);
 if(!arr.length)return openLevel(currentLevel);

 const typeLabel=sessionType==="translation"?"✍️ Traducción":"🎧 Escucha y repite";
 const intro=sessionType==="translation"
    ?"Todas las frases de esta sesión están en la misma pantalla. Escribe las traducciones y compruébalas individualmente."
    :"Todas las frases de esta sesión están en la misma pantalla. Escucha cada frase y valórate individualmente.";

 document.getElementById("main").innerHTML=`
  <div class="sessionbar session-all-header">
 <button class="btn smallbtn" onclick="exitSession()">← Salir</button>   <div style="flex:1;text-align:center">
    <b>${typeLabel}</b>
 <div class="muted small">
  ${currentLevel
    ? `${currentLevel}${currentPart!==null?` · Parte ${currentPart}`:""}`
    : "Repaso general"
  } · ${arr.length} frases · v1.7
 </div>   </div>
  </div>
  <div class="card study-intro">
    <div class="muted small">${intro}</div>
    <div id="speechStatus" class="muted small" style="margin-top:6px">🔊 Audio listo</div>
  </div>
  <section class="all-study-list">
    ${arr.map((x,i)=>sessionPhraseCard(x,i+1)).join("")}
  </section>
  <div class="actions all-study-footer">
    <button class="btn primary" onclick="finishSession()">✓ Terminar sesión</button>
 </div>`;
}

function exitSession(){
 stopPartAudio();
 currentLevel=null;
 currentPart=null;
 sessionType=null;
 sessionIds=[];
 sessionPracticedIds=new Set();
 sessionPos=0;
 setNav("home");
 home();
}

function finishSession(){
 registerStudyDay();

 if(currentLevel && currentPart!==null){
  openPart(currentLevel,currentPart);
  return;
 }

 if(currentLevel){
  openLevel(currentLevel);
  return;
 }

 exitSession();
}

function sessionPhraseCard(x,num){
 if(sessionType==="translation"){
  return `<article class="card study-item" id="study-${x.id}">
    <div class="study-item-head">
     <span class="muted small">${num} / ${sessionIds.length} · ${x.level}</span>
     <span class="muted small">${x.tags.join(" · ")}</span>
    </div>
    <div class="all-translation-row">
     <div class="all-translation-prompt"><b>${escapeHtml(x.es)}</b></div>
     <div class="all-translation-rating">
       <span class="muted tiny">✍️ Dominio</span>
       ${stars(x.translationStars,x.id,"translation")}
     </div>
    </div>
    <input class="answer" id="answer-${x.id}" placeholder="Escribe el francés..." autocomplete="off" onkeydown="if(event.key==='Enter')checkAllAnswer(${JSON.stringify(x.id)})">
    <div class="actions">
     <button class="btn primary" onclick="checkAllAnswer(${JSON.stringify(x.id)})">Comprobar</button>
     <button class="btn" data-speak-id='${escapeHtml(String(x.id))}'>🔊 Escuchar</button>
    </div>
    <div id="feedback-${x.id}"></div>
   </article>`;
 }
 return `<article class="card study-item" id="study-${x.id}">
    <div class="study-item-head">
     <span class="muted small">${num} / ${sessionIds.length} · ${x.level}</span>
     <span class="muted small">${x.tags.join(" · ")}</span>
    </div>
    <div class="listen-row">
     <div class="listen-text">
       <div class="listen-fr">${escapeHtml(x.fr)}</div>
       <div id="spanish-${x.id}" class="listen-es hidden">${escapeHtml(x.es)}</div>
     </div>
     <div class="listen-actions">
       <button class="btn primary" data-speak-id='${escapeHtml(String(x.id))}'>🔊 Escuchar</button>
       <button class="btn" onclick="toggleSpanishById(${JSON.stringify(x.id)})">🇪🇸 Español</button>
     </div>
    </div>
    <div class="actions" style="margin-top:12px">
     <span class="muted tiny">🎧 Dominio</span>
     ${stars(x.pronunciationStars,x.id,"pronunciation")}
    </div>
   </article>`;
}
