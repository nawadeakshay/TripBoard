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
  document.querySelectorAll(".nav-link").forEach((b) =>
    b.toggleAttribute("aria-current", b.dataset.view === name)
  );
  if (name === "trips") loadTrips();
}
document.querySelectorAll("[data-view]").forEach((b) =>
  b.addEventListener("click", () => showView(b.dataset.view))
);

// ---------- User menu (avatar + name; dropdown holds Sign out) ----------
function setUserMenuOpen(open) {
  $("user-dropdown").hidden = !open;
  $("user-button").setAttribute("aria-expanded", String(open));
}
$("user-button").addEventListener("click", (e) => {
  e.stopPropagation();
  setUserMenuOpen($("user-dropdown").hidden);
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".user-menu")) setUserMenuOpen(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setUserMenuOpen(false);
});

// ---------- Auth ----------
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  document.body.classList.toggle("signed-out", !user);
  $("nav").hidden = !user;
  const name = user ? user.displayName || (user.email || "").split("@")[0] : "";
  $("user-name").textContent = name;
  $("user-avatar").textContent = name.charAt(0).toUpperCase();
  $("user-email").textContent = user ? user.email || "" : "";
  setUserMenuOpen(false);
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
function setSearchStatus(text, cls = "") {
  $("search-status").textContent = text;
  $("search-status").className = `search-status ${cls}`;
}

$("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("search-input").value.trim();
  if (!name) return;
  setSearchStatus("Searching…");
  $("search-result").replaceChildren();
  try {
    const result = await fetchCountryWithWeather(name);
    setSearchStatus("");
    $("search-result").append(renderResult(result));
  } catch (err) {
    setSearchStatus(err.message, "error");
  }
});

$("search-input").addEventListener("input", () => {
  $("search-clear").hidden = !$("search-input").value;
});
$("search-clear").addEventListener("click", () => {
  $("search-input").value = "";
  $("search-clear").hidden = true;
  $("search-result").replaceChildren();
  setSearchStatus("");
  $("search-input").focus();
});

// Static icon markup (constants only, never user data), wrapped in a span.
const ICONS = {
  capital: '<path d="M3 21h18M4 10h16M12 3l9 5H3zM6 10v8M10 10v8M14 10v8M18 10v8"/>',
  population: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.6-3.3 3-5 6-5s5.4 1.7 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14c2.6 0 4.4 1.5 5 4"/>',
  region: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  currency: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1.2-1.6-2-3-2-1.7 0-3 1-3 2.3 0 3 6 1.7 6 4.6 0 1.3-1.3 2.3-3 2.3-1.4 0-2.6-.8-3-2M12 5.5v2M12 16.7v1.8"/>',
  thermometer: '<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/><path d="M12 9v7"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h7"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
};
function icon(name, className = "") {
  const span = el("span", { className: `ico ${className}` });
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  return span;
}

// Country photos we have assets for; other countries get a large-flag panel instead.
const COUNTRY_PHOTOS = {
  JP: "images/country-japan.webp",
  FR: "images/country-france.webp",
  GR: "images/country-greece.webp",
};

// Open-Meteo returns times in GMT, e.g. "2026-10-31T09:45".
function formatWeatherTime(time) {
  const d = new Date(`${time}Z`);
  return Number.isNaN(d.getTime()) ? time : d.toLocaleString(undefined, {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
}

function formatCoords(lat, lng) {
  if (lat == null || lng == null) return "—";
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}\n${Math.abs(lng).toFixed(2)}°${lng >= 0 ? "E" : "W"}`;
}

// Next 24 months as "YYYY-MM" values (same format the old month input saved).
function monthOptions() {
  const now = new Date();
  return Array.from({ length: 24 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return el("option", { value, textContent: formatMonth(value) });
  });
}

function fact(iconName, label, value) {
  return el("div", { className: "fact" },
    icon(iconName),
    el("div", {}, el("dt", { textContent: label }), el("dd", { textContent: value })),
  );
}

function stat(iconName, label, value) {
  return el("div", { className: "stat" },
    icon(iconName),
    el("div", {}, el("span", { className: "stat-label", textContent: label }), el("strong", { textContent: value })),
  );
}

function renderResult({ country, weather, weatherError }) {
  // --- Country panel ---
  const photoSrc = COUNTRY_PHOTOS[country.code];
  const photo = photoSrc
    ? el("div", { className: "country-photo" }, el("img", { src: photoSrc, alt: `Scenery in ${country.name}` }))
    : el("div", { className: "country-photo flag-fallback" }, el("img", { src: country.flagUrl, alt: country.flagAlt }));
  if (!photoSrc) photo.style.setProperty("--flag", `url("${country.flagUrl}")`);

  const countryPanel = el("article", { className: "panel country-panel" },
    photo,
    el("div", { className: "country-info" },
      el("div", { className: "country-head" },
        el("div", { className: "flag-box" }, el("img", { src: country.flagUrl, alt: country.flagAlt })),
        el("div", {},
          el("h3", { textContent: country.name }),
          country.officialName !== country.name ? el("p", { className: "official", textContent: country.officialName }) : null,
        ),
      ),
      el("dl", { className: "facts" },
        fact("capital", "Capital", country.capital),
        fact("population", "Population", country.population.toLocaleString()),
        fact("region", "Region", country.region),
        fact("currency", "Currency", country.currency),
      ),
    ),
  );

  // --- Weather panel (Open-Meteo, called with the capital's coordinates) ---
  const capitalName = country.capital.split(",")[0];
  const weatherPanel = el("article", { className: "panel weather-panel" }, el("div", { className: "weather-inner" },
    el("div", { className: "weather-head" },
      el("h4", {}, "Current Weather ", el("span", { textContent: `(${capitalName})` })),
      weather ? el("small", { textContent: `Updated: ${formatWeatherTime(weather.time)}` }) : null,
    ),
    weather
      ? el("div", { className: "weather-main" },
          icon("thermometer", "weather-icon"),
          el("div", {},
            el("div", { className: "temp", textContent: `${weather.temperature}${weather.tempUnit}` }),
            el("div", { className: "temp-sub", textContent: `Right now in ${capitalName}` }),
          ),
        )
      : el("p", { className: "weather-error", textContent: `Weather unavailable: ${weatherError}` }),
    el("div", { className: "weather-stats" },
      stat("thermometer", "Temperature", weather ? `${weather.temperature}${weather.tempUnit}` : "—"),
      stat("wind", "Wind Speed", weather ? `${weather.windSpeed} ${weather.windUnit}` : "—"),
      stat("pin", "Coordinates", formatCoords(country.lat, country.lng)),
    ),
  ));

  // --- Plan Your Trip (saves to Firestore) ---
  const month = el("select", { required: true },
    el("option", { value: "", textContent: "Select month" }), ...monthOptions());
  const note = el("textarea", { rows: 2, maxLength: 500, placeholder: "e.g. Visit during winter for snow and cherry blossoms" });
  const counter = el("small", { className: "counter", textContent: "0/500" });
  const updateCounter = () => { counter.textContent = `${note.value.length}/500`; };
  note.addEventListener("input", updateCounter);
  const status = el("span", { className: "plan-status" });
  const saveBtn = el("button", { type: "submit", className: "btn-primary save-btn" }, icon("bookmark"), "Save Trip");

  const form = el("form", { className: "panel plan-panel" },
    el("div", { className: "plan-intro" },
      icon("calendar", "plan-icon"),
      el("div", {},
        el("h4", { textContent: "Plan Your Trip" }),
        el("p", { textContent: "Save this destination to your travel list and plan it for later." }),
      ),
    ),
    el("label", { className: "plan-field" },
      el("span", { textContent: "Planned Travel Month" }),
      el("div", { className: "select-wrap" }, icon("calendar"), month, icon("chevron", "chev")),
    ),
    el("label", { className: "plan-field plan-note" },
      el("span", { textContent: "Your Note (optional)" }),
      el("div", { className: "note-wrap" }, note, counter),
    ),
    el("div", { className: "plan-action" }, saveBtn, status),
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    saveBtn.disabled = true;
    status.textContent = "Saving…";
    status.className = "plan-status";
    try {
      await addDoc(collection(db, "users", currentUser.uid, "trips"), {
        country,
        weatherAtSave: weather, // snapshot of weather when saved
        month: month.value,
        note: note.value.trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const viewTrips = el("button", { type: "button", className: "link strong", textContent: "View My Trips" });
      viewTrips.addEventListener("click", () => showView("trips"));
      status.replaceChildren("Saved to My Trips ✓ ", viewTrips);
      status.className = "plan-status ok";
      form.reset();
      updateCounter();
    } catch (err) {
      status.textContent = err.message;
      status.className = "plan-status error";
    } finally {
      saveBtn.disabled = false;
    }
  });

  return el("div", { className: "result" },
    country.isDemo ? el("p", { className: "error", textContent:
      "Using the REST Countries demo key, which always returns a sample country. Set REST_COUNTRIES_API_KEY in config.js." }) : null,
    el("div", { className: "result-grid" }, countryPanel, weatherPanel),
    form,
  );
}

// ---------- My Trips (Firestore read / update / delete) ----------
// Trips are loaded once per visit; filtering and sorting happen in the browser.
let trips = [];
let tripFilter = "all";

const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

function formatMonthShort(value) {
  if (!value) return "No date";
  const [y, m] = value.split("-").map(Number);
  return new Date(y, m - 1).toLocaleString(undefined, { month: "short", year: "numeric" });
}

const EMPTY_TEXT = {
  all: ["No trips saved yet", "Search for a country, explore details and save it to your travel list."],
  upcoming: ["No upcoming trips", "Trips planned for this month or later will show up here."],
  past: ["No past trips", "Trips whose planned month has passed will show up here."],
};

function visibleTrips() {
  const now = currentMonth();
  const list = trips.filter(({ data }) =>
    tripFilter === "all" ? true
      : tripFilter === "upcoming" ? (data.month || "") >= now
      : Boolean(data.month) && data.month < now
  );
  // Firestore returns newest first (orderBy createdAt desc).
  const sort = $("trips-sort").value;
  if (sort === "oldest") list.reverse();
  if (sort === "travel") list.sort((a, b) => (a.data.month || "9999").localeCompare(b.data.month || "9999"));
  return list;
}

function renderTrips() {
  const list = visibleTrips();
  $("trips-list").replaceChildren(...list.map(({ id, data }) => renderTrip(id, data)));
  $("trips-empty").hidden = list.length > 0;
  [$("trips-empty-title").textContent, $("trips-empty-text").textContent] = EMPTY_TEXT[tripFilter];
}

document.querySelectorAll("[data-filter]").forEach((b) =>
  b.addEventListener("click", () => {
    tripFilter = b.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((x) =>
      x.setAttribute("aria-selected", String(x === b))
    );
    renderTrips();
  })
);
$("trips-sort").addEventListener("change", renderTrips);

async function loadTrips() {
  if (!currentUser) return;
  $("trips-status").textContent = "Loading your trips…";
  $("trips-status").className = "search-status";
  $("trips-list").replaceChildren();
  $("trips-empty").hidden = true;
  try {
    const q = query(collection(db, "users", currentUser.uid, "trips"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    trips = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    $("trips-status").textContent = "";
    renderTrips();
  } catch (err) {
    $("trips-status").textContent = err.message;
    $("trips-status").className = "search-status error";
  }
}

function tripPhoto(country) {
  const src = COUNTRY_PHOTOS[country.code];
  if (src) return el("img", { src, alt: `Scenery in ${country.name}` });
  return el("img", { src: country.flagUrl, alt: country.flagAlt });
}

function renderTrip(id, trip) {
  const ref = doc(db, "users", currentUser.uid, "trips", id);
  const country = trip.country;

  const photo = el("div", { className: `trip-photo${COUNTRY_PHOTOS[country.code] ? "" : " flag-fallback"}` },
    tripPhoto(country),
    el("span", { className: "month-chip" }, icon("calendar"), formatMonthShort(trip.month)),
  );
  if (!COUNTRY_PHOTOS[country.code]) photo.style.setProperty("--flag", `url("${country.flagUrl}")`);

  const noteView = el("p", {
    className: `trip-note${trip.note ? "" : " empty"}`,
    textContent: trip.note || "No note yet. Click Edit to add one.",
  });
  const status = el("p", { className: "trip-status" });

  const editBtn = el("button", { type: "button", className: "btn-outline" }, icon("pencil"), "Edit");
  const deleteBtn = el("button", { type: "button", className: "btn-danger" }, icon("trash"), "Delete");
  const actions = el("div", { className: "trip-actions" }, editBtn, deleteBtn);

  editBtn.addEventListener("click", () => {
    const input = el("textarea", { rows: 3, maxLength: 500, value: trip.note || "", placeholder: "Add a short note" });
    const counter = el("small", { className: "counter", textContent: `${input.value.length}/500` });
    input.addEventListener("input", () => { counter.textContent = `${input.value.length}/500`; });
    const save = el("button", { type: "button", className: "btn-primary" }, "Save note");
    const cancel = el("button", { type: "button", className: "btn-outline" }, "Cancel");
    const editor = el("div", { className: "trip-editor" },
      el("div", { className: "note-wrap" }, input, counter),
      el("div", { className: "trip-actions" }, save, cancel),
    );
    noteView.replaceWith(editor);
    actions.hidden = true;
    status.textContent = "";
    input.focus();

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
        noteView.textContent = newNote || "No note yet. Click Edit to add one.";
        noteView.classList.toggle("empty", !newNote);
        editor.replaceWith(noteView);
        actions.hidden = false;
        status.textContent = "Note updated ✓";
        status.className = "trip-status ok";
      } catch (err) {
        save.disabled = false;
        status.textContent = err.message;
        status.className = "trip-status error";
      }
    });
  });

  deleteBtn.addEventListener("click", async () => {
    if (!confirm(`Delete your trip to ${country.name}?`)) return;
    deleteBtn.disabled = true;
    try {
      await deleteDoc(ref);
      trips = trips.filter((t) => t.id !== id);
      renderTrips();
    } catch (err) {
      deleteBtn.disabled = false;
      status.textContent = err.message;
      status.className = "trip-status error";
    }
  });

  return el("article", { className: "panel trip-card" },
    photo,
    el("div", { className: "trip-body" },
      el("div", { className: "trip-title" },
        el("span", { className: "trip-flag" }, el("img", { src: country.flagUrl, alt: country.flagAlt })),
        el("h3", { textContent: country.name }),
      ),
      el("div", { className: "trip-place" }, icon("pin"), country.capital),
      noteView,
      actions,
      status,
    ),
  );
}
