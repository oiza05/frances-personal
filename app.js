const KEY="frances-personal-v2";
const DB_NAME="frances-personal-db";
const DB_VERSION=1;
const DB_STORE="app";
const DB_DATA_KEY="library";
const DB_META_KEY="meta";
const AUDIO_STATS_KEY="frances-audio-stats";
const TODAY_STATS_KEY="frances-today-stats";
const SYNC_CONFIG_KEY="frances-personal-sync-config";
const SYNC_STATE_KEY="frances-personal-sync-state";
const APP_VERSION="v1.7";
let syncConfig=null;
let syncClient=null;
let syncUser=null;
let syncBusy=false;
let audioStats={seconds:0};
let todayStats={date:null,practices:0,phraseIds:[],audioSeconds:0};
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
loadTodayStats();
let dbReady=false;
let saveTimer=null;
async function loadAudioStats(){
 let localSeconds=0;
 try{
  const saved=JSON.parse(localStorage.getItem(AUDIO_STATS_KEY)||"null");
  if(saved && typeof saved==="object")localSeconds=Math.max(0,Number(saved.seconds)||0);
 }catch(e){}
 let dbSeconds=0;
 try{
  const saved=await dbGet("audioStats");
  dbSeconds=Math.max(0,Number(saved?.seconds)||0);
 }catch(e){}
 audioStats={seconds:Math.max(localSeconds,dbSeconds)};
 saveAudioStats();
 try{await dbSet("audioStats",audioStats)}catch(e){}
}
function saveAudioStats(){
 try{localStorage.setItem(AUDIO_STATS_KEY,JSON.stringify(audioStats));}catch(e){}
 try{dbSet("audioStats",audioStats).catch(()=>{})}catch(e){}
}
function addAudioSeconds(seconds){
 const n=Math.max(0,Number(seconds)||0);
 if(!n)return;
 audioStats.seconds+=n;
 saveAudioStats();
 registerTodayAudio(n);
}
function formatAudioMinutes(){
 const totalMinutes=Math.floor(audioStats.seconds/60);
 const hours=Math.floor(totalMinutes/60);
 const minutes=totalMinutes%60;
 if(hours===0)return minutes+" min";
 if(minutes===0)return hours+" h";
 return hours+" h "+minutes+" min";
}
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
function loadTodayStats(){
 const today=getTodayKey();
 try{
  const saved=JSON.parse(localStorage.getItem(TODAY_STATS_KEY)||"null");
  if(saved?.date===today){todayStats={date:today,practices:Number(saved.practices)||0,phraseIds:Array.isArray(saved.phraseIds)?saved.phraseIds:[],audioSeconds:Number(saved.audioSeconds)||0};return;}
 }catch(e){}
 todayStats={date:today,practices:0,phraseIds:[],audioSeconds:0};saveTodayStats();
}
function saveTodayStats(){try{localStorage.setItem(TODAY_STATS_KEY,JSON.stringify(todayStats));}catch(e){}}
function ensureTodayStats(){if(todayStats.date!==getTodayKey()){todayStats={date:getTodayKey(),practices:0,phraseIds:[],audioSeconds:0};saveTodayStats();}}
function registerTodayPractice(id){ensureTodayStats();todayStats.practices++;if(!todayStats.phraseIds.some(x=>String(x)===String(id)))todayStats.phraseIds.push(id);saveTodayStats();}
function registerTodayAudio(seconds){ensureTodayStats();todayStats.audioSeconds+=Math.max(0,Number(seconds)||0);saveTodayStats();}
function formatTodayAudio(){const m=Math.floor(todayStats.audioSeconds/60),h=Math.floor(m/60),min=m%60;return h?(min?h+" h "+min+" min":h+" h"):(min+" min");}
function getTodayLearnedWords(){
 const words=new Set();
 data.filter(x=>todayStats.phraseIds.some(id=>String(id)===String(x.id))).forEach(x=>{
  normalize(x.fr).split(" ").filter(Boolean).forEach(word=>words.add(word));
 });
 return words.size;
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
 // Ya se ha estudiado hoy
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
 const avg=arr.reduce((sum,x)=>{
  const stars=Math.min(5,Math.max(1,Number(x[key])||1));
  return sum+stars;
 },0)/arr.length;
 return Math.round(Math.min(100,Math.max(0,((avg-1)/4)*100)));
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
  const payload={phrases:data.map(migratePhrase),localUpdatedAt,audioSeconds:audioStats.seconds};
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
   const payload={phrases:data.map(migratePhrase),localUpdatedAt,audioSeconds:audioStats.seconds};
   const {error}=await c.from("user_data").upsert({user_id:syncUser.id,data:payload,updated_at:new Date(localUpdatedAt).toISOString()},{onConflict:"user_id"});
   if(error)throw error;
   syncMsg("☁️ Biblioteca subida por primera vez.");return;
  }
  if(remote.updatedAt>localUpdatedAt){
   const incoming=Array.isArray(remote.data?.phrases)?remote.data.phrases:null;
   if(incoming){data=incoming.map(migratePhrase);if(Number.isFinite(Number(remote.data?.audioSeconds)))audioStats.seconds=Math.max(audioStats.seconds,Number(remote.data.audioSeconds)||0);saveAudioStats();localUpdatedAt=remote.updatedAt;await dbSet(DB_DATA_KEY,data);await dbSet(DB_META_KEY,{updatedAt:localUpdatedAt});renderCurrent();syncMsg("☁️ Datos descargados desde la nube.");return;}
  }
  if(localUpdatedAt>remote.updatedAt){
   const payload={phrases:data.map(migratePhrase),localUpdatedAt,audioSeconds:audioStats.seconds};
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
 const map={home:"navHome",statistics:"navStatistics",library:"navLibrary",sync:"navSync"};
 const id=map[active]||"navHome";
 document.getElementById(id)?.classList.add("active");
}
function stars(n,id,type){
 let s='<div class="stars">';
 for(let i=1;i<=5;i++) s+=`<button class="star ${i<=n?"on":""}" onclick="rate(${JSON.stringify(id)},${i},'${type}')" aria-label="${type} ${i} estrellas">★</button>`;
 return s+"</div>";
}
function registerPhrasePractice(x){
 if(!x)return;
 x.practiceCount=(Number(x.practiceCount)||0)+1;
 x.lastPracticed=new Date().toISOString();
 registerTodayPractice(x.id);
 save();
}
window.rate=(id,n,type)=>{
 const x=data.find(a=>String(a.id)===String(id)); 
 if(!x)return;
 if(type==="pronunciation")x.pronunciationStars=n;
 if(type==="translation")x.translationStars=n;
 registerPhrasePractice(x);
 renderCurrent();
};
function goHome(){
 currentLevel=null; sessionType=null; sessionIds=[]; sessionPos=0; setNav("home"); home();
}
function getLearnedWords(){
 const words=new Set();
 data.filter(x=>(Number(x.translationStars)||1)>=4 && (Number(x.pronunciationStars)||1)>=4).forEach(x=>{
  normalize(x.fr).split(" ").forEach(word=>{if(word)words.add(word);});
 });
 return words;
}
function statistics(){
 setNav("statistics");
 const total=data.length;
 const mastered=data.filter(x=>(Number(x.translationStars)||1)>=4 && (Number(x.pronunciationStars)||1)>=4).length;
 const practiced=data.filter(x=>(Number(x.practiceCount)||0)>0).length;
 const learnedWords=getLearnedWords().size;
 const translationPct=masteryPercent(data,"translationStars")??0;
 const pronunciationPct=masteryPercent(data,"pronunciationStars")??0;
 const overall=total?Math.round((translationPct+pronunciationPct)/2):0;
 document.getElementById("main").innerHTML=`
  <section>
   <div class="section-head"><div><h2>📊 Estadísticas</h2><div class="muted">Tu progreso general en francés.</div></div></div>
   <div class="level-grid">
    <div class="card"><div class="muted small">Frases</div><div style="font-size:28px;font-weight:800">${total}</div><div class="muted small">en tu biblioteca</div></div>
    <div class="card"><div class="muted small">Dominadas</div><div style="font-size:28px;font-weight:800">${mastered}</div><div class="muted small">4⭐ o más en ambas áreas</div></div>
    <div class="card"><div class="muted small">Practicadas</div><div style="font-size:28px;font-weight:800">${practiced}</div><div class="muted small">al menos una vez</div></div>
    <div class="card"><div class="muted small">Palabras aprendidas</div><div style="font-size:28px;font-weight:800">${learnedWords}</div><div class="muted small">palabras únicas de frases dominadas</div></div>\n    <div class="card"><div class="muted small">🎧 Audio escuchado</div><div style="font-size:28px;font-weight:800">${formatAudioMinutes()}</div><div class="muted small">tiempo total de reproducción</div></div>
   </div>
   <div class="card" style="margin-top:16px">
    <div class="section-head" style="margin-bottom:12px"><div><b>🎯 Dominio general</b><div class="muted small">Promedio de traducción y pronunciación.</div></div><b style="font-size:24px">${overall}%</b></div>
    <div class="level-progress"><span style="width:${overall}%"></span></div>
    <div class="stats-split" style="margin-top:14px"><div><span class="muted small">✍️ Traducción</span><br><b>${translationPct}%</b></div><div><span class="muted small">🎧 Pronunciación</span><br><b>${pronunciationPct}%</b></div></div>
   </div>
   <div class="card" style="margin-top:16px"><b>📚 Por nivel</b><div style="margin-top:12px">
    ${levels.map(level=>{
      const arr=data.filter(x=>x.level===level);
      const pct=masteryPercent(arr,"translationStars");
      const pctP=masteryPercent(arr,"pronunciationStars");
      const pctAll=(pct===null||pctP===null)?null:Math.round((pct+pctP)/2);
      return `<div style="margin-bottom:14px"><div class="section-head" style="margin-bottom:6px"><span><b>${level}</b> · ${arr.length} frases</span><span>${pctAll===null?"—":pctAll+"%"}</span></div><div class="level-progress"><span style="width:${pctAll===null?0:pctAll}%"></span></div></div>`;
    }).join("")}
   </div></div>
   <div class="card" style="margin-top:16px">
    <div class="section-head" style="margin-bottom:12px"><div><h3 style="margin:0">📅 Estadísticas de hoy</h3><div class="muted small">Actividad de hoy</div></div></div>
    <div class="level-grid">
     <div class="card"><div class="muted small">Prácticas</div><div style="font-size:28px;font-weight:800">${todayStats.practices}</div><div class="muted small">veces practicadas hoy</div></div>
     <div class="card"><div class="muted small">Frases distintas</div><div style="font-size:28px;font-weight:800">${todayStats.phraseIds.length}</div><div class="muted small">frases trabajadas hoy</div></div>
     <div class="card"><div class="muted small">🎧 Audio hoy</div><div style="font-size:28px;font-weight:800">${formatTodayAudio()}</div><div class="muted small">tiempo escuchado hoy</div></div>
    </div>
   </div>
  </section>
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
       <div class="level-count">${c} ${c===1?"frase":"frases"}</div>
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
       <div class="sub-library-count">${n} ${n===1?"frase":"frases"}</div>
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
  // 1. Frases practicadas con pocas estrellas
  const aWeak=(aPracticed>0 ? (6-aStars)*100 : 0);
  const bWeak=(bPracticed>0 ? (6-bStars)*100 : 0);
  // 2. Frases antiguas: cuanto más tiempo, más prioridad
  const aAge=aLast
    ? Math.min((now-aLast)/86400000,30)
    : 0;
  const bAge=bLast
    ? Math.min((now-bLast)/86400000,30)
    : 0;
  // 3. Frases nuevas reciben una prioridad moderada
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
 currentLevel=null;
 currentPart=null;
 sessionType=type;
 sessionIds=selected.map(x=>x.id);
 renderSession();
}
function startSession(level,type,part=null){
 const pool=data.filter(x=>x.level===level && (part===null || Number(x.part)===Number(part)));
 if(!pool.length){alert("Todavía no hay frases en este nivel.");return}
 currentLevel=level;
 currentPart=part;
 sessionType=type;
 // Prioritize lower ratings, then randomize within the same rating.
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
<button class="btn smallbtn" onclick="currentLevel ? (currentPart!==null ? openPart('${currentLevel}',currentPart) : openLevel('${currentLevel}')) : goHome()">← Salir</button>
<div style="flex:1;text-align:center">
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
function finishSession(){
  registerStudyDay();

  if(currentLevel===null){
    goHome();
    return;
  }

  if(currentPart!==null){
    openPart(currentLevel,currentPart);
  }else{
    openLevel(currentLevel);
  }
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
   <div class="all-pron-rating">
    <span class="muted tiny">🎧 ¿Cómo te ha salido?</span>
    ${stars(x.pronunciationStars,x.id,"pronunciation")}
   </div>
  </article>`;
}
function checkAllAnswer(id){
 const x=data.find(a=>String(a.id)===String(id));
 const input=document.getElementById(`answer-${id}`);
 const fb=document.getElementById(`feedback-${id}`);
 if(!x||!input||!fb)return;
 const raw=input.value.trim();
 if(!raw){
  fb.innerHTML='<div class="feedback wrong-feedback"><b>⚠️ Falta tu respuesta.</b><br><span class="muted">Escribe la frase en francés y vuelve a pulsar Comprobar.</span></div>';
  input.focus();
  return;
 }
 registerPhrasePractice(x);
 const got=normalize(raw);
 const expected=normalize(x.fr);
 const exact=got===expected;
 if(exact){
  fb.innerHTML=
   '<div class="feedback correct-feedback">'+
   '<b>✅ ¡Correcto!</b><br>'+
   '<span class="muted">Tu respuesta coincide con la frase esperada.</span>'+
   '</div>';
 }else{
  fb.innerHTML=
   '<div class="feedback wrong-feedback">'+
   '<b>❌ Hay una diferencia.</b>'+
   '<div style="margin-top:8px"><span class="muted">Tú escribiste:</span><br><b>'+escapeHtml(raw)+'</b></div>'+
   '<div style="margin-top:10px"><span class="muted">La frase correcta es:</span><br>'+
   '<b class="expected-answer">'+escapeHtml(x.fr)+'</b></div>'+
   '</div>';
 }
 input.disabled=true;
}
function toggleSpanishById(id){
 document.getElementById(`spanish-${id}`)?.classList.toggle("hidden");
}
function library(){
 currentLevel=null; setNav("library");
 renderLibrary();
}
function renderLibrary(){
 const q=libraryQuery.toLowerCase();
 const tags=[...new Set(data.flatMap(x=>x.tags))].sort();
 const arr=data.filter(x=>
  (!q || [x.es,x.fr,x.level,...x.tags].join(" ").toLowerCase().includes(q)) &&
  (selectedTag==="Todas"||x.tags.includes(selectedTag))
 );
 document.getElementById("main").innerHTML=`
  <section>
   <div class="section-head"><div><h2>Biblioteca</h2><div class="muted">${data.length} frases · <span id="dataStatus">${dbReady?"Datos locales listos":"Preparando datos…"}</span></div></div>
   <div class="actions">
    <button class="btn" onclick="addPhrase()">➕ Añadir</button>
    <button class="btn" onclick="exportJSON()">⬇️ JSON</button>
    <button class="btn" onclick="importFile()">⬆️ Importar</button>
    <button class="btn" onclick="openSync()">☁️ Nube</button>
   </div></div>
   <div class="searchbar"><input id="libSearch" type="search" value="${escapeHtml(libraryQuery)}" placeholder="Buscar español, francés, nivel o etiqueta..." oninput="libraryQuery=this.value;renderLibrary()"></div>
   <div class="chips"><button class="chip ${selectedTag==="Todas"?"active":""}" onclick="selectedTag='Todas';renderLibrary()">Todas</button>${tags.map(t=>`<button class="chip ${selectedTag===t?"active":""}" onclick="selectedTag=${JSON.stringify(t)};renderLibrary()">${escapeHtml(t)}</button>`).join("")}</div>
   <div class="phrase-list">${arr.map(phraseRow).join("")||'<div class="empty">No se encontraron frases.</div>'}</div>
  </section>`;
}
function addPhrase(){
 const es=prompt("Español:"); if(!es)return;
 const fr=prompt("Francés:"); if(!fr)return;
 const level=(prompt("Nivel (A1, A2, B1, B2, C1, C2):","A1")||"A1").toUpperCase();
 const part=Math.min(4,Math.max(1,Number(prompt("Parte (1, 2, 3 o 4):","1"))||1));
 const tags=(prompt("Etiquetas, separadas por comas:","")||"").split(",").map(x=>x.trim()).filter(Boolean);
 data.push(migratePhrase({id:Date.now(),es,fr,level:levels.includes(level)?level:"A1",part,tags,pronunciationStars:1,translationStars:1}));
 save(); renderLibrary();
}
function editPhrase(id){
 const x=data.find(a=>String(a.id)===String(id)); if(!x)return;
 const es=prompt("Español:",x.es); if(es===null)return;
 const fr=prompt("Francés:",x.fr); if(fr===null)return;
 const level=(prompt("Nivel:",x.level)||x.level).toUpperCase();
 const part=Math.min(4,Math.max(1,Number(prompt("Parte (1, 2, 3 o 4):",String(x.part||1)))||1));
 const tags=(prompt("Etiquetas, separadas por comas:",x.tags.join(", "))||"").split(",").map(x=>x.trim()).filter(Boolean);
 Object.assign(x,{es,fr,level:levels.includes(level)?level:x.level,part,tags});
 save(); renderCurrent();
}
function deletePhrase(id){
 if(!confirm("¿Eliminar esta frase?"))return;
 data=data.filter(x=>String(x.id)!==String(id)); save(); renderCurrent();
}
function exportJSON(){
 const backup={version:1,app:"frances-personal",exportedAt:new Date().toISOString(),phrases:data.map(migratePhrase)};
 const blob=new Blob([JSON.stringify(backup,null,2)],{type:"application/json"});
 const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="frances-personal-backup.json";a.click();URL.revokeObjectURL(a.href);
 setDataStatus("Copia de seguridad descargada");
}
function importFile(){
 const input=document.createElement("input"); input.type="file"; input.accept=".json,.csv,text/csv,application/json";
 input.onchange=()=>{const f=input.files[0];if(!f)return;const r=new FileReader();r.onload=()=>importData(String(r.result),f.name);r.readAsText(f)};
 input.click();
}
function importData(text,name){
 try{
  let incoming;
  if(name.toLowerCase().endsWith(".json")) {
   const parsed=JSON.parse(text);
   incoming=Array.isArray(parsed)?parsed:(Array.isArray(parsed.phrases)?parsed.phrases:null);
  }
  else incoming=parseCSV(text);
  if(!Array.isArray(incoming))throw new Error("Formato no válido");
  incoming=incoming.map(migratePhrase).filter(x=>x.es&&x.fr);
  if(!incoming.length)throw new Error("No hay frases válidas");
  const replace=confirm(`Se han encontrado ${incoming.length} frases. Aceptar = REEMPLAZAR biblioteca. Cancelar = AÑADIR a la biblioteca.`);
  data=replace?incoming:[...data,...incoming];
  save(); library();
 }catch(e){alert("No se pudo importar: "+e.message)}
}
function parseCSV(text){
 const rows=[];let row=[],cell="",quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];
  if(c==='"'&&quoted&&n==='"'){cell+='"';i++;continue}
  if(c==='"'){quoted=!quoted;continue}
  if(!quoted&&c===","){row.push(cell);cell="";continue}
  if(!quoted&&(c==="\n"||c==="\r")){if(c==="\r"&&n==="\n")i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell="";continue}
  cell+=c;
 }
 row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
 if(rows.length<2)return [];
 const h=rows[0].map(x=>normalize(x));
 const idx=(...names)=>h.findIndex(x=>names.includes(x));
 const ie=idx("espanol","español","es","spanish"),ifn=idx("frances","francés","fr","french"),il=idx("nivel","level"),ipa=idx("parte","part"),it=idx("etiquetas","tags","colecciones","collections"),ip=idx("pronunciacion","pronunciation","estrellaspronunciacion"),itn=idx("traduccion","translation","estrellastraduccion");
 return rows.slice(1).map(r=>({id:Date.now()+Math.random(),es:r[ie]||"",fr:r[ifn]||"",level:(r[il]||"A1").toUpperCase(),part:Math.min(4,Math.max(1,Number(r[ipa])||1)),tags:(r[it]||"").split(/[|,]/).map(x=>x.trim()).filter(Boolean),pronunciationStars:Number(r[ip])||1,translationStars:Number(r[itn])||1}));
}
let frenchVoice=null;
function getFrenchVoice(){
 if(!('speechSynthesis' in window))return null;
 const voices=window.speechSynthesis.getVoices()||[];
 frenchVoice=voices.find(v=>/^fr(-|$)/i.test(String(v.lang)))||null;
 return frenchVoice;
}
if('speechSynthesis' in window){
 getFrenchVoice();
 window.speechSynthesis.onvoiceschanged=()=>getFrenchVoice();
}
function setSpeechStatus(message){
 const el=document.getElementById('speechStatus');
 if(el)el.textContent=message;
}
function cleanSpeechText(value){
 return String(value??'')
  .normalize('NFC')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,' ')
  .replace(/[\u200B-\u200D\uFEFF]/g,'')
  .replace(/[\u00A0\u202F]/g,' ')
  .replace(/[\r\n\t]+/g,' ')
  .replace(/\s+/g,' ')
  .trim();
}
let speechBusy=false;
let speechStartedAt=0;
function playPartAudio(items){
 if(!('speechSynthesis' in window)){
  alert('Este navegador no admite reproducción de voz.');
  return;
 }
 if(!items || !items.length)return;
 stopPartAudio();
 partAudioItems=items;
 partAudioIndex=0;
 partAudioPlaying=true;
 setSpeechStatus(`🔊 Reproduciendo 1/${partAudioItems.length}…`);
 playNextPartAudio();
}
function playNextPartAudio(){
 if(!partAudioPlaying)return;
 if(partAudioIndex>=partAudioItems.length){
  partAudioPlaying=false;
  partAudioItems=[];
  partAudioIndex=0;
  setSpeechStatus('✅ Parte terminada');
  return;
 }
 const phrase=cleanSpeechText(partAudioItems[partAudioIndex]?.fr);
 if(!phrase){
  partAudioIndex++;
  setTimeout(playNextPartAudio,100);
  return;
 }
 const number=partAudioIndex+1;
 setSpeechStatus(`🔊 Reproduciendo ${number}/${partAudioItems.length}…`);
 const synth=window.speechSynthesis;
 try{
  synth.cancel();
  synth.resume();
 }catch(e){}
 const u=new SpeechSynthesisUtterance(phrase);
 u.lang='fr-FR';
 u.onstart=()=>{speechStartedAt=performance.now();};
 u.rate=0.88;
 u.pitch=1;
 const voice=getFrenchVoice();
 if(voice)u.voice=voice;
 u.onend=()=>{
  if(speechStartedAt){addAudioSeconds((performance.now()-speechStartedAt)/1000);speechStartedAt=0;}
  if(!partAudioPlaying)return;
  partAudioIndex++;
  partAudioTimer=setTimeout(()=>{
   if(partAudioPlaying)playNextPartAudio();
  },1000);
 };
 u.onerror=(event)=>{
  if(speechStartedAt){addAudioSeconds((performance.now()-speechStartedAt)/1000);speechStartedAt=0;}
  if(!partAudioPlaying)return;
  console.warn(
   'SpeechSynthesis error:',
   event?.error||'unknown',
   phrase
  );
  partAudioIndex++;
  partAudioTimer=setTimeout(()=>{
   if(partAudioPlaying)playNextPartAudio();
  },500);
 };
 try{
  synth.speak(u);
  setTimeout(()=>{
   try{synth.resume();}catch(e){}
  },100);
 }catch(e){
  console.warn('No se pudo iniciar el audio:',e);
  partAudioIndex++;
  partAudioTimer=setTimeout(()=>{
   if(partAudioPlaying)playNextPartAudio();
  },500);
 }
}
function stopPartAudio(){
 partAudioPlaying=false;
 partAudioItems=[];
 partAudioIndex=0;
 if(partAudioTimer){
  clearTimeout(partAudioTimer);
  partAudioTimer=null;
 }
 if('speechSynthesis' in window){
  try{window.speechSynthesis.cancel();}catch(e){}
 }
 setSpeechStatus('🔊 Audio listo');
}
function speak(text){
 if(!('speechSynthesis' in window)){
  setSpeechStatus('⚠️ Este navegador no admite voz.');
  alert('Este navegador no admite reproducción de voz.');
  return;
 }
 const phrase=cleanSpeechText(text);
 if(!phrase)return;
 const synth=window.speechSynthesis;
 speechBusy=true;
 setSpeechStatus('🔊 Preparando audio…');
 try{synth.cancel();}catch(e){}
 // En algunos móviles, cancelar y volver a hablar dentro del mismo
 // evento de clic hace que la segunda orden se pierda. Dejamos pasar
 // un pequeño intervalo y reanudamos el motor antes de hablar.
 setTimeout(()=>{
  try{synth.resume();}catch(e){}
  const u=new SpeechSynthesisUtterance(phrase);
  u.lang='fr-FR';
  u.rate=0.88;
  u.pitch=1;
  const voice=getFrenchVoice();
  if(voice)u.voice=voice;
  u.onstart=()=>{speechStartedAt=performance.now();setSpeechStatus('🔊 Reproduciendo…');};
  u.onend=()=>{if(speechStartedAt){addAudioSeconds((performance.now()-speechStartedAt)/1000);speechStartedAt=0;}speechBusy=false;setSpeechStatus('✅ Audio terminado');};
  u.onerror=(event)=>{
   if(speechStartedAt){addAudioSeconds((performance.now()-speechStartedAt)/1000);speechStartedAt=0;}
   speechBusy=false;
   console.warn('SpeechSynthesis error:',event?.error||'unknown',phrase);
   setSpeechStatus('⚠️ No se pudo reproducir esta frase.');
  };
  try{
   synth.speak(u);
   // Si el motor quedó en estado pausado, reanudar unos milisegundos después.
   setTimeout(()=>{try{synth.resume();}catch(e){}},100);
  }catch(e){
   speechBusy=false;
   console.warn('No se pudo iniciar la voz:',e);
   setSpeechStatus('⚠️ No se pudo iniciar el audio.');
  }
 },60);
}
// Usamos delegación de eventos en lugar de onclick inline. Así el texto
// de la frase nunca se interpreta como código HTML/JavaScript.
document.addEventListener('click',event=>{
 const btn=event.target.closest?.('[data-speak-id]');
 if(!btn)return;
 const id=btn.getAttribute('data-speak-id');
 const phrase=data.find(x=>String(x.id)===String(id));
 if(phrase)speak(phrase.fr);
});
function renderCurrent(){
 if(sessionType&&sessionIds.length){renderSession();return}
 if(currentLevel){openLevel(currentLevel);return}
 if(document.getElementById("navLibrary").classList.contains("active")){renderLibrary();return}
 home();
}
(async function init(){
 await loadData();
 await loadAudioStats();
 await syncInit();
 home();
})();
