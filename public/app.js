import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  setPersistence, browserLocalPersistence, browserSessionPersistence, sendPasswordResetEmail,
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
  document.body.classList.toggle("signed-out", !user);
  $("nav").hidden = !user;
  $("user-email").textContent = user ? user.email || "" : "";
  showView(user ? "search" : "auth");
});

// Friendlier text for the Firebase Auth errors users are likely to hit.
const AUTH_ERRORS = {
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/missing-password": "Please enter your password.",
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/email-already-in-use": "An account with this email already exists. Try signing in.",
  "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
  "auth/popup-closed-by-user": "Google sign-in was cancelled.",
  "auth/popup-blocked": "The Google sign-in popup was blocked. Allow popups for this site and try again.",
  "auth/network-request-failed": "Network error. Check your connection and try again.",
};
function showAuthMessage(text, ok = false) {
  $("auth-error").textContent = text;
  $("auth-error").classList.toggle("ok", ok);
}
const authErrorText = (err) => AUTH_ERRORS[err.code] || err.message;

// "Remember me": keep the session after the browser closes (local) or only for this tab (session).
// Applied when the box changes (not inside the Google click), so the popup still opens immediately
// on click and isn't caught by popup blockers. Checked matches Firebase's default (local).
const applyPersistence = () =>
  setPersistence(auth, $("remember").checked ? browserLocalPersistence : browserSessionPersistence);
$("remember").addEventListener("change", () => applyPersistence().catch((e) => showAuthMessage(e.message)));

// Sign in / Create account tabs share one form; the mode decides which Firebase call runs.
let authMode = "sign-in";
function setAuthMode(mode) {
  authMode = mode;
  const signUp = mode === "sign-up";
  $("tab-sign-in").setAttribute("aria-selected", String(!signUp));
  $("tab-sign-up").setAttribute("aria-selected", String(signUp));
  $("auth-sub").textContent = signUp
    ? "Create an account to start planning your trips"
    : "Sign in to continue to your travel planner";
  $("email-submit").textContent = signUp ? "Create account" : "Sign in";
  $("password").autocomplete = signUp ? "new-password" : "current-password";
  $("sign-in-extras").hidden = signUp;
  $("sign-up-hint").hidden = !signUp;
  $("switch-text").textContent = signUp ? "Already have an account?" : "Don't have an account?";
  $("switch-mode").textContent = signUp ? "Sign in" : "Create account";
  showAuthMessage("");
}
$("tab-sign-in").addEventListener("click", () => setAuthMode("sign-in"));
$("tab-sign-up").addEventListener("click", () => setAuthMode("sign-up"));
$("switch-mode").addEventListener("click", () =>
  setAuthMode(authMode === "sign-in" ? "sign-up" : "sign-in")
);

$("toggle-password").addEventListener("click", () => {
  const show = $("password").type === "password";
  $("password").type = show ? "text" : "password";
  $("toggle-password").setAttribute("aria-pressed", String(show));
  $("toggle-password").setAttribute("aria-label", show ? "Hide password" : "Show password");
});

$("forgot-password").addEventListener("click", async () => {
  const email = $("email").value.trim();
  if (!email) {
    showAuthMessage("Enter your email address above, then click “Forgot password?”.");
    $("email").focus();
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    showAuthMessage(`If an account exists for ${email}, a password reset link has been sent.`, true);
  } catch (err) {
    showAuthMessage(authErrorText(err));
  }
});

$("google-sign-in").addEventListener("click", async () => {
  showAuthMessage("");
  $("google-sign-in").disabled = true;
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    showAuthMessage(authErrorText(e));
  } finally {
    $("google-sign-in").disabled = false;
  }
});

$("email-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showAuthMessage("");
  const email = $("email").value;
  const password = $("password").value;
  $("email-submit").disabled = true;
  try {
    if (authMode === "sign-up") await createUserWithEmailAndPassword(auth, email, password);
    else await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    showAuthMessage(authErrorText(err));
  } finally {
    $("email-submit").disabled = false;
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
