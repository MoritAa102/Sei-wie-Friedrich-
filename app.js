/* app.js — Spiel + sichtbare Fehlermeldungen im Startscreen */
const startErr = document.getElementById("startError");
function show(msg) {
  if (startErr) startErr.textContent = msg;
  console.log(msg);
}
window.addEventListener("error", (e) => show("JS-Fehler: " + (e?.message || e)));
window.addEventListener("unhandledrejection", (e) =>
  show("Promise-Fehler: " + (e?.reason?.message || e?.reason || e))
);

import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection,
  serverTimestamp, onSnapshot, writeBatch, increment,
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

/* ---------- Fragen ---------- */
const QUESTIONS = [
  { type: "map", title: "Karte", prompt: "Setze die Pinnnadel möglichst nah an Friedrichs Geburtsort.", max: 10 },
  {
    type: "single", title: "Geburtszeit", prompt: "In welchem Jahrhundert möchtest du geboren werden?",
    options: ["15. Jahrhundert","16. Jahrhundert","18. Jahrhundert","20. Jahrhundert"],
    correct: "18. Jahrhundert", pointsCorrect: 10, pointsWrong: 1, wrongMsg: "Trostpreis."
  },
  {
    type: "single", title: "Beruf", prompt: "Wähle deinen Beruf.",
    options: ["Papst","König","Admiral","Bürgermeister"],
    correct: "König", pointsCorrect: 10, pointsWrong: 3, wrongMsg: "Trostpreis."
  },
  {
    type: "multi", title: "Hobbys", prompt: "Wähle deine Hobbys (mehrere möglich) und gib dann ab.",
    options: ["Fahrradfahren","Flöte spielen","Krieg führen","Karten lesen"],
    correctSet: new Set(["Flöte spielen","Krieg führen"]),
    wrongPenaltyEach: 3, pointsPerCorrect: 10, max: 20
  },
  {
    type: "single", title: "Spitzname", prompt: "Du hast nun einige Kriege gewonnen — gib dir einen Spitznamen.",
    options: ["Friedrich der Große","Friedrich der Kriegsführer","Der Unbesiegbare","Friedrich der zweite Gott"],
    correct: "Friedrich der Große", pointsCorrect: 10, pointsWrong: 3, wrongMsg: "Trostpreis."
  },
  {
    type: "multiFinal", title: "Finale", prompt: "Finale Frage: Was bin ich alles gewesen?",
    options: ["Reformer","Profisportler","Kartoffelliebhaber","Bogenschütze","Herrscher von Europa","Militärstratege"],
    correctSet: new Set(["Reformer","Kartoffelliebhaber","Militärstratege"]),
    max: 40, penaltyPerMissing: 13
  },
];

/* ---------- Firebase init ---------- */
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const views = {
  start: $("view-start"),
  lobby: $("view-lobby"),
  question: $("view-question"),
  feedback: $("view-feedback"),
  results: $("view-results"),
};
function showView(name) {
  Object.values(views).forEach(v => v.classList.add("hidden"));
  views[name]?.classList.remove("hidden");
}

const statusBar = $("statusBar");
const nameInput = $("nameInput");
const roomInput = $("roomInput");
const btnCreate = $("btnCreate");
const btnJoin = $("btnJoin");
const btnCopyCode = $("btnCopyCode");
const btnStartGame = $("btnStartGame");
const playersList = $("playersList");
const roomCodeText = $("roomCodeText");
const lobbyHint = $("lobbyHint");

const qTitle = $("qTitle");
const qPrompt = $("qPrompt");
const qError = $("qError");
const qWaiting = $("qWaiting");
const mapWrap = $("mapWrap");
const optionsWrap = $("optionsWrap");
const optionsDiv = $("options");
const btnSubmit = $("btnSubmit");

const scoreRing = $("scoreRing");
const ringValue = $("ringValue");
const deltaText = $("deltaText");
const deltaMsg = $("deltaMsg");
const waitingNext = $("waitingNext");
const btnNext = $("btnNext");

const leaderboard = $("leaderboard");
const btnRestart = $("btnRestart");

/* ---------- State ---------- */
const state = {
  uid: null,
  name: null,
  roomId: null,
  isHost: false,
  currentRoom: null,
  players: [],
  roomUnsub: null,
  playersUnsub: null,
  submissionsUnsub: null,
  map: null,
  mapMarker: null,
  mapPick: null,
};

/* ---------- Helpers ---------- */
function normCode(s){ return (s||"").trim().toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6); }
function makeRoomCode(){
  const a="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let out="";
  for(let i=0;i<6;i++) out += a[Math.floor(Math.random()*a.length)];
  return out;
}
function setStatus(){
  const parts=[];
  if(state.name) parts.push(`Name: ${state.name}`);
  if(state.roomId) parts.push(`Raum: ${state.roomId}`);
  if(state.isHost) parts.push("Host");
  statusBar.textContent = parts.join(" • ") || "Verbunden ✅";
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c])); }

const roomRef = () => doc(db, "rooms", state.roomId);
const playersCol = () => collection(db, "rooms", state.roomId, "players");
const submissionsCol = () => collection(db, "rooms", state.roomId, "submissions");
const myPlayerRef = () => doc(db, "rooms", state.roomId, "players", state.uid);
const mySubmissionRef = (qIndex) => doc(db, "rooms", state.roomId, "submissions", `${qIndex}_${state.uid}`);

/* ---------- Scoring ---------- */
const BERLIN = { lat: 52.52, lng: 13.405 };
const PRUSSIA_BOX = { minLat: 50.8, maxLat: 55.8, minLng: 10.5, maxLng: 22.8 };
function inPrussiaBox(lat,lng){
  return lat>=PRUSSIA_BOX.minLat && lat<=PRUSSIA_BOX.maxLat && lng>=PRUSSIA_BOX.minLng && lng<=PRUSSIA_BOX.maxLng;
}
function haversineKm(a,b){
  const R=6371;
  const dLat=(b.lat-a.lat)*Math.PI/180, dLng=(b.lng-a.lng)*Math.PI/180;
  const lat1=a.lat*Math.PI/180, lat2=b.lat*Math.PI/180;
  const x=Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}
function scoreMapPick(pick){
  const dist=haversineKm(BERLIN,pick);
  if(dist<=20) return {points:10,msg:"Treffer! Fast genau Berlin."};
  if(dist<=100) return {points:9,msg:"Sehr nah dran."};
  if(inPrussiaBox(pick.lat,pick.lng)) return {points:8,msg:"In Preußen — solide!"};
  const d=Math.min(dist,2000);
  const p=Math.max(0,Math.round(7*(1-(d-100)/1900)));
  return {points:p,msg:p>0?"Außerhalb Preußens — je weiter, desto weniger.":"Zu weit weg 😅"};
}
function scoreQuestion(qIndex, answer){
  const q=QUESTIONS[qIndex];
  if(q.type==="map") return scoreMapPick(answer);
  if(q.type==="single"){
    const ok=answer===q.correct;
    return { points: ok ? q.pointsCorrect : q.pointsWrong, msg: ok ? "Richtig!" : (q.wrongMsg||"Trostpreis.") };
  }
  if(q.type==="multi"){
    const selected=new Set(answer||[]);
    let points=0;
    for(const opt of selected){
      if(q.correctSet.has(opt)) points += q.pointsPerCorrect;
      else points -= q.wrongPenaltyEach;
    }
    points = Math.max(0, Math.min(q.max, points));
    return { points, msg: points===q.max ? "Perfekt!" : (points>0 ? "Teilweise richtig." : "Leider nichts getroffen.") };
  }
  if(q.type==="multiFinal"){
    const selected=new Set(answer||[]);
    let hit=0;
    for(const opt of selected) if(q.correctSet.has(opt)) hit++;
    if(hit===0) return {points:0,msg:"Nur falsch angekreuzt → 0%."};
    const missing=3-hit;
    const points=Math.max(0,q.max - missing*q.penaltyPerMissing);
    return {points,msg: points===q.max ? "Du bist wirklich Friedrich." : `Fast! Dir fehlen ${missing} richtige Auswahl(en).`};
  }
  return {points:0,msg:""};
}

/* ---------- Auth start ---------- */
show("✅ app.js geladen — melde anonym an…");
const cred = await signInAnonymously(auth);
state.uid = cred.user.uid;

onAuthStateChanged(auth, (user) => {
  if (!user) return;
  state.uid = user.uid;
  statusBar.textContent = "Verbunden ✅";
});

/* ---------- UI: Create/Join ---------- */
btnCreate.addEventListener("click", async () => {
  try {
    show("");
    const name = nameInput.value.trim();
    if(!name) return show("Bitte Name eingeben.");
    state.name = name;
    state.roomId = makeRoomCode();

    await setDoc(roomRef(), {
      hostId: state.uid,
      phase: "lobby",
      qIndex: -1,
      scoredUpTo: -1,
      createdAt: serverTimestamp(),
    });

    await setDoc(myPlayerRef(), {
      name,
      joinedAt: serverTimestamp(),
      totalScore: 0,
      lastDelta: 0,
      lastMsg: "",
      readyNext: false,
    });

    await enterRoom();
  } catch (e) {
    show("Raum erstellen fehlgeschlagen: " + (e?.message || e));
  }
});

btnJoin.addEventListener("click", async () => {
  try {
    show("");
    const name = nameInput.value.trim();
    if(!name) return show("Bitte Name eingeben.");

    const code = normCode(roomInput.value);
    if(code.length!==6) return show("Bitte 6-stelligen Raumcode eingeben.");

    state.name = name;
    state.roomId = code;

    const snap = await getDoc(roomRef());
    if(!snap.exists()) return show("Raum nicht gefunden. Tippfehler?");

    await setDoc(myPlayerRef(), {
      name,
      joinedAt: serverTimestamp(),
      totalScore: 0,
      lastDelta: 0,
      lastMsg: "",
      readyNext: false,
    }, { merge:true });

    await enterRoom();
  } catch (e) {
    show("Raum beitreten fehlgeschlagen: " + (e?.message || e));
  }
});

btnCopyCode.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(state.roomId);
    lobbyHint.textContent = "Code kopiert ✅";
    setTimeout(() => lobbyHint.textContent = "", 1200);
  } catch {
    lobbyHint.textContent = "Kopieren nicht möglich.";
  }
});

btnStartGame.addEventListener("click", async () => {
  if(!state.isHost) return;
  await startQuestion(0);
});

/* ---------- Enter room + listeners ---------- */
async function enterRoom(){
  setStatus();
  roomCodeText.textContent = state.roomId;
  showView("lobby");

  state.roomUnsub?.();
  state.playersUnsub?.();
  state.submissionsUnsub?.();

  state.roomUnsub = onSnapshot(roomRef(), (snap) => {
    if(!snap.exists()) return;
    state.currentRoom = snap.data();
    state.isHost = state.currentRoom.hostId === state.uid;
    setStatus();
    renderByRoomState();
  });

  state.playersUnsub = onSnapshot(playersCol(), (snap) => {
    state.players = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderPlayers();
    renderByRoomState();
  });
}

function renderPlayers(){
  playersList.innerHTML = "";
  const sorted=[...state.players].sort((a,b)=>(a.joinedAt?.seconds||0)-(b.joinedAt?.seconds||0));
  for(const p of sorted){
    const li=document.createElement("li");
    const isHost = state.currentRoom?.hostId === p.id;
    li.innerHTML = `<div>${escapeHtml(p.name||"???")}</div><div class="badge">${isHost?"Host":"Spieler"}</div>`;
    playersList.appendChild(li);
  }

  btnStartGame.classList.toggle("hidden", !(state.isHost && state.currentRoom?.phase==="lobby"));
  lobbyHint.textContent = state.isHost ? "Du bist Host. Wenn alle da sind: Spiel starten." : "Warte auf den Host…";
}

/* ---------- Game flow (Host drives) ---------- */
async function startQuestion(qIndex){
  const batch=writeBatch(db);
  for(const p of state.players){
    batch.update(doc(db,"rooms",state.roomId,"players",p.id), { readyNext:false });
  }
  batch.update(roomRef(), { phase:"question", qIndex, questionStartedAt: serverTimestamp() });
  await batch.commit();
}

async function goToFeedbackIfReady(){
  if(!state.isHost) return;
  const room=state.currentRoom;
  if(!room || room.phase!=="question") return;
  const qIndex=room.qIndex;
  if(room.scoredUpTo >= qIndex) return;

  state.submissionsUnsub?.();
  state.submissionsUnsub = onSnapshot(submissionsCol(), async (snap) => {
    const subs = snap.docs.map(d=>({id:d.id, ...d.data()})).filter(x=>x.qIndex===qIndex);
    const submitted = new Set(subs.map(s=>s.uid));
    if(submitted.size < state.players.length) return;

    const fresh = (await getDoc(roomRef())).data();
    if(fresh.scoredUpTo >= qIndex) return;

    const batch=writeBatch(db);
    for(const p of state.players){
      const sub = subs.find(s=>s.uid===p.id);
      const scored = scoreQuestion(qIndex, sub?.answer);
      batch.update(doc(db,"rooms",state.roomId,"players",p.id), {
        totalScore: increment(scored.points),
        lastDelta: scored.points,
        lastMsg: scored.msg || ""
      });
    }
    batch.update(roomRef(), { phase:"feedback", scoredUpTo:qIndex });
    await batch.commit();
  });
}

async function goNextIfAllReady(){
  if(!state.isHost) return;
  const room=state.currentRoom;
  if(!room || room.phase!=="feedback") return;
  const allReady = state.players.length>0 && state.players.every(p=>p.readyNext===true);
  if(!allReady) return;

  const next = room.qIndex + 1;
  if(next >= QUESTIONS.length){
    const batch=writeBatch(db);
    for(const p of state.players){
      batch.update(doc(db,"rooms",state.roomId,"players",p.id), { readyNext:false });
    }
    batch.update(roomRef(), { phase:"results" });
    await batch.commit();
    return;
  }
  await startQuestion(next);
}

/* ---------- Render states ---------- */
function renderByRoomState(){
  const room=state.currentRoom;
  if(!room) return;

  if(room.phase==="lobby"){ showView("lobby"); return; }
  if(room.phase==="question"){
    showView("question");
    renderQuestion(room.qIndex);
    goToFeedbackIfReady();
    return;
  }
  if(room.phase==="feedback"){
    showView("feedback");
    renderFeedback();
    goNextIfAllReady();
    return;
  }
  if(room.phase==="results"){
    showView("results");
    renderResults();
    return;
  }
}

/* ---------- Question UI ---------- */
function renderQuestion(qIndex){
  const q=QUESTIONS[qIndex];
  qTitle.textContent = `${qIndex+1}/${QUESTIONS.length} — ${q.title}`;
  qPrompt.textContent = q.prompt;
  qError.textContent = "";
  qWaiting.textContent = "";
  btnSubmit.disabled=false;
  btnSubmit.textContent="Abgeben";

  state.mapPick=null;

  if(q.type==="map"){
    optionsWrap.classList.add("hidden");
    mapWrap.classList.remove("hidden");
    initMapOnce();
    resetMapMarker();
  } else {
    mapWrap.classList.add("hidden");
    optionsWrap.classList.remove("hidden");
    renderOptions(q);
  }

  onSnapshot(mySubmissionRef(qIndex), (snap) => {
    if(snap.exists()){
      btnSubmit.disabled=true;
      btnSubmit.textContent="Abgegeben ✅";
      qWaiting.textContent="Warte auf die anderen…";
    }
  });
}

function renderOptions(q){
  optionsDiv.innerHTML="";
  const isMulti = q.type==="multi" || q.type==="multiFinal";
  for(const opt of q.options){
    const row=document.createElement("label");
    row.className="opt";
    row.innerHTML = `<input type="${isMulti?"checkbox":"radio"}" name="qopt" value="${escapeHtml(opt)}"><span>${escapeHtml(opt)}</span>`;
    optionsDiv.appendChild(row);
  }
}

btnSubmit.addEventListener("click", async () => {
  const room=state.currentRoom;
  if(!room || room.phase!=="question") return;
  const qIndex=room.qIndex;
  const q=QUESTIONS[qIndex];

  try{
    let answer=null;
    if(q.type==="map"){
      if(!state.mapPick){ qError.textContent="Bitte Pinnnadel setzen."; return; }
      answer={...state.mapPick};
    } else {
      const inputs=[...optionsDiv.querySelectorAll("input")];
      if(q.type==="single"){
        const chosen=inputs.find(i=>i.checked);
        if(!chosen){ qError.textContent="Bitte wähle eine Option."; return; }
        answer=chosen.value;
      } else {
        answer=inputs.filter(i=>i.checked).map(i=>i.value);
      }
    }

    await setDoc(mySubmissionRef(qIndex), { uid: state.uid, qIndex, answer, submittedAt: serverTimestamp() }, { merge:true });
    qWaiting.textContent="Abgegeben. Warte auf die anderen…";
    btnSubmit.disabled=true;
  } catch(e){
    qError.textContent="Fehler beim Absenden: " + (e?.message || e);
  }
});

/* ---------- Leaflet Map ---------- */
function initMapOnce(){
  if(state.map) return;

  state.map = L.map("map", { worldCopyJump:true }).setView([52.2,13.4], 4);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom:9, attribution:"&copy; OpenStreetMap" }).addTo(state.map);

  state.map.on("click", (e) => {
    state.mapPick = { lat: e.latlng.lat, lng: e.latlng.lng };
    if(state.mapMarker) state.map.removeLayer(state.mapMarker);
    state.mapMarker = L.marker(e.latlng).addTo(state.map);
  });

  setTimeout(()=>state.map.invalidateSize(), 200);
}
function resetMapMarker(){
  if(!state.map) return;
  if(state.mapMarker){ state.map.removeLayer(state.mapMarker); state.mapMarker=null; }
  state.mapPick=null;
  setTimeout(()=>state.map.invalidateSize(), 200);
}

/* ---------- Feedback ---------- */
function setRing(total){
  const t=Math.max(0,Math.min(100,Math.round(total)));
  ringValue.textContent = `${t}%`;
  const deg=(t/100)*360;
  scoreRing.style.background = `conic-gradient(var(--primary) ${deg}deg, rgba(255,255,255,.08) 0deg)`;
}
function renderFeedback(){
  const me = state.players.find(p=>p.id===state.uid) || {};
  setRing(me.totalScore ?? 0);
  deltaText.textContent = `+${me.lastDelta ?? 0}%`;
  deltaMsg.textContent = me.lastMsg ?? "";

  const notReady = state.players.filter(p=>!p.readyNext).length;
  waitingNext.textContent = notReady>0 ? `Noch ${notReady} Spieler drücken "Weiter"…` : "Alle bereit.";
  btnNext.disabled = me.readyNext === true;
  btnNext.textContent = me.readyNext ? "Warten…" : "Weiter";
}
btnNext.addEventListener("click", async () => {
  try { await updateDoc(myPlayerRef(), { readyNext:true }); }
  catch(e){ deltaMsg.textContent = "Weiter fehlgeschlagen: " + (e?.message || e); }
});

/* ---------- Results ---------- */
function rankSaying(rank, total){
  if(rank===1) return "Du bist HIMM.";
  if(rank===total) return "Weißt du überhaupt, wer Friedrich ist?";
  const arr=["Stabil – aber da geht noch was.","Nicht schlecht, Soldat.","Du bist auf dem richtigen Weg.","Solide Runde.","Fast königlich."];
  return arr[(rank-2)%arr.length];
}
function renderResults(){
  const sorted=[...state.players].sort((a,b)=>(b.totalScore??0)-(a.totalScore??0));
  leaderboard.innerHTML="";
  sorted.forEach((p,idx)=>{
    const rank=idx+1;
    const row=document.createElement("div");
    row.className="rowItem";
    row.innerHTML = `
      <div class="rankLeft">
        <div class="rankTop">
          <div class="rankNum">#${rank}</div>
          <div class="rankName">${escapeHtml(p.name||"???")}</div>
        </div>
        <div class="rankSay">${escapeHtml(rankSaying(rank, sorted.length))}</div>
      </div>
      <div class="rankScore">${Math.round(p.totalScore ?? 0)}%</div>
    `;
    leaderboard.appendChild(row);
  });
}
btnRestart.addEventListener("click", ()=>location.reload());

/* ---------- Auto-check loop ---------- */
setInterval(() => {
  if(!state.currentRoom) return;
  if(state.isHost && state.currentRoom.phase==="question") goToFeedbackIfReady();
  if(state.isHost && state.currentRoom.phase==="feedback") goNextIfAllReady();
}, 800);

show("✅ Firebase verbunden. Du kannst jetzt einen Raum erstellen.");
