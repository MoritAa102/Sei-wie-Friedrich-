// app.js — DEBUG HEADER (zeigt Fehler im Startscreen)
const startErr = document.getElementById("startError");
function show(msg) {
  if (startErr) startErr.textContent = msg;
  console.log(msg);
}

window.addEventListener("error", (e) => show("JS-Fehler: " + (e?.message || e)));
window.addEventListener("unhandledrejection", (e) =>
  show("Promise-Fehler: " + (e?.reason?.message || e?.reason || e))
);

show("✅ app.js geladen — Firebase Test startet…");
import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

show("✅ Firebase init ok. Versuche Anonymous Login…");

const cred = await signInAnonymously(auth);
show("✅ Anonymous Login ok. UID: " + cred.user.uid.slice(0, 6) + "…");

show("✅ Versuche Firestore write…");
await setDoc(doc(db, "debug", cred.user.uid), { t: serverTimestamp(), ok: true }, { merge: true });

show("✅ Firestore write OK. Firebase ist korrekt eingerichtet!");
