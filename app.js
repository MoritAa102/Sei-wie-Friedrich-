// app.js (SMOKE TEST)
const el = document.getElementById("startError");
if (el) el.textContent = "✅ app.js geladen";

const btn = document.getElementById("btnCreate");
if (btn) {
  btn.addEventListener("click", () => {
    alert("✅ Klick funktioniert");
  });
} else {
  if (el) el.textContent = "❌ btnCreate nicht gefunden (ID falsch?)";
}
