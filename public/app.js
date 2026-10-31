import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, getDocs, updateDoc, deleteDoc, doc,
  query, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./config.js";
import { fetchCountryWithWeather } from "./api.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
let currentUser = null;

// ---------- Small DOM helper (uses textContent, so user notes can't inject HTML) ----------
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) if (c != null) node.append(c);
  return node;
}

function formatMonth(value) {
  if (!value) return "—";
  const [y, m] = value.split("-").map(Number);
  return new Date(y, m - 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}

// ---------- Navigation ----------
function showView(name) {
  for (const v of ["auth", "search", "trips"]) $(`view-${v}`).hidden = v !== name;
  if (name === "trips") loadTrips();
}
document.querySelectorAll("[data-view]").forEach((b) =>
  b.addEventListener("click", () => showView(b.dataset.view))
);

// ---------- Auth ----------
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  $("nav").hidden = !user;
  $("user-email").textContent = user ? user.email || "" : "";
  showView(user ? "search" : "auth");
});

$("google-sign-in").addEventListener("click", async () => {
  $("auth-error").textContent = "";
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    $("auth-error").textContent = e.message;
  }
});

$("email-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("auth-error").textContent = "";
  const action = e.submitter?.dataset.action;
  const email = $("email").value;
  const password = $("password").value;
  try {
    if (action === "sign-up") await createUserWithEmailAndPassword(auth, email, password);
    else await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    $("auth-error").textContent = err.message;
  }
});

$("sign-out").addEventListener("click", () => signOut(auth));

// ---------- Search (API chain: REST Countries -> Open-Meteo) ----------
$("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("search-input").value.trim();
  if (!name) return;
  $("search-status").textContent = "Searching…";
  $("search-status").className = "";
  $("search-result").replaceChildren();
  try {
    const result = await fetchCountryWithWeather(name);
    $("search-status").textContent = "";
    $("search-result").append(renderResult(result));
  } catch (err) {
    $("search-status").textContent = err.message;
    $("search-status").className = "error";
  }
});

function renderResult({ country, weather, weatherError }) {
  const weatherText = weather
    ? `${weather.temperature} ${weather.tempUnit}, wind ${weather.windSpeed} ${weather.windUnit} (as of ${weather.time} UTC)`
    : `Unavailable: ${weatherError}`;

  const details = el("dl", {},
    el("dt", { textContent: "Capital" }), el("dd", { textContent: country.capital }),
    el("dt", { textContent: "Population" }), el("dd", { textContent: country.population.toLocaleString() }),
    el("dt", { textContent: "Region" }), el("dd", { textContent: country.region }),
    el("dt", { textContent: "Currency" }), el("dd", { textContent: country.currency }),
    el("dt", { textContent: "Weather in capital" }), el("dd", { textContent: weatherText }),
  );

  const month = el("input", { type: "month", required: true });
  const note = el("textarea", { rows: 3, maxLength: 500, placeholder: "Short note (optional)" });
  const status = el("span");
  const saveBtn = el("button", { type: "submit", textContent: "Save Trip" });

  const form = el("form", { className: "save-form" },
    el("label", { textContent: "Planned travel month: " }, month),
    note,
    el("div", { className: "row" }, saveBtn, status),
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    saveBtn.disabled = true;
    status.textContent = "Saving…";
    status.className = "";
    try {
      await addDoc(collection(db, "users", currentUser.uid, "trips"), {
        country,
        weatherAtSave: weather, // snapshot of weather when saved
        month: month.value,
        note: note.value.trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      status.textContent = "Saved to My Trips ✓";
      status.className = "ok";
      form.reset();
    } catch (err) {
      status.textContent = err.message;
      status.className = "error";
    } finally {
      saveBtn.disabled = false;
    }
  });

  return el("div", { className: "card" },
    country.isDemo ? el("p", { className: "error", textContent:
      "Using the REST Countries demo key, which always returns a sample country. Set REST_COUNTRIES_API_KEY in config.js." }) : null,
    el("img", { className: "flag", src: country.flagUrl, alt: country.flagAlt }),
    el("h3", { textContent: country.name }),
    el("p", { className: "muted", textContent: country.officialName }),
    details,
    form,
  );
}

// ---------- My Trips (Firestore read / update / delete) ----------
async function loadTrips() {
  if (!currentUser) return;
  $("trips-status").textContent = "Loading…";
  $("trips-list").replaceChildren();
  try {
    const q = query(collection(db, "users", currentUser.uid, "trips"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    $("trips-status").textContent = snap.empty ? "No trips saved yet. Search a country to add one." : "";
    snap.forEach((d) => $("trips-list").append(renderTrip(d.id, d.data())));
  } catch (err) {
    $("trips-status").textContent = err.message;
  }
}

function renderTrip(id, trip) {
  const ref = doc(db, "users", currentUser.uid, "trips", id);
  const noteView = el("p", { textContent: trip.note || "(no note)" });
  const status = el("span");

  const editBtn = el("button", { textContent: "Edit note" });
  const deleteBtn = el("button", { textContent: "Delete" });
  const actions = el("div", { className: "row" }, editBtn, deleteBtn, status);

  editBtn.addEventListener("click", () => {
    const input = el("textarea", { rows: 3, maxLength: 500, value: trip.note || "" });
    const save = el("button", { textContent: "Save" });
    const cancel = el("button", { textContent: "Cancel" });
    const editor = el("div", {}, input, el("div", { className: "row" }, save, cancel));
    noteView.replaceWith(editor);
    actions.hidden = true;

    cancel.addEventListener("click", () => {
      editor.replaceWith(noteView);
      actions.hidden = false;
    });
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        const newNote = input.value.trim();
        await updateDoc(ref, { note: newNote, updatedAt: serverTimestamp() });
        trip.note = newNote;
        noteView.textContent = newNote || "(no note)";
        editor.replaceWith(noteView);
        actions.hidden = false;
        status.textContent = "Note updated ✓";
        status.className = "ok";
      } catch (err) {
        save.disabled = false;
        alert(err.message);
      }
    });
  });

  const card = el("div", { className: "card" });
  deleteBtn.addEventListener("click", async () => {
    if (!confirm(`Delete trip to ${trip.country.name}?`)) return;
    try {
      await deleteDoc(ref);
      card.remove();
      if (!$("trips-list").children.length) $("trips-status").textContent = "No trips saved yet.";
    } catch (err) {
      status.textContent = err.message;
      status.className = "error";
    }
  });

  const w = trip.weatherAtSave;
  card.append(
    el("img", { className: "flag", src: trip.country.flagUrl, alt: trip.country.flagAlt }),
    el("h3", { textContent: `${trip.country.name} — ${formatMonth(trip.month)}` }),
    el("p", { className: "muted", textContent:
      `Capital: ${trip.country.capital} · Region: ${trip.country.region}` +
      (w ? ` · Weather when saved: ${w.temperature} ${w.tempUnit}` : "") }),
    noteView,
    actions,
  );
  return card;
}
