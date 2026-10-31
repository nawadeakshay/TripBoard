# TripBoard – Mini Travel Planner

Sign in → search a country → see live country details + current weather in its capital → save it as a trip (month + note) in Cloud Firestore → view / edit / delete trips.

Plain HTML + vanilla JS (ES modules), no build step. Firebase JS SDK v10 loaded from Google's CDN. Hosted on Firebase Hosting.

## Files

| File | Purpose |
|---|---|
| `public/index.html` | Three screens: Sign in, Search, My Trips (shown/hidden by JS) |
| `public/api.js` | REST Countries + Open-Meteo calls and the chaining logic |
| `public/app.js` | Firebase Auth, Firestore CRUD, rendering |
| `public/config.js` | Firebase web config + REST Countries API key |
| `public/images/` | Design images: sign-in collage, search hero, Japan photo (other countries show their flag) |
| `firestore.rules` | Security rules: users can only access their own trips |
| `firebase.json` | Hosting + rules deploy config |

## How it works

### API chaining (`api.js → fetchCountryWithWeather`)
1. `fetchCountry(name)` calls REST Countries and normalises the response into `{ name, flagUrl, capital, population, region, currency, lat, lng }`. The search is a substring match, so it prefers an exact name match (e.g. "india" → India, not British Indian Ocean Territory).
2. Only after step 1 resolves, it reads the capital's coordinates (`lat`, `lng`) and calls Open-Meteo `current=temperature_2m,wind_speed_10m`.
3. If weather fails, or the country has no capital coordinates, the country data still displays with a "weather unavailable" note. A failure in step 1 stops the chain and shows the error.

**Note on REST Countries:** the `v3.1` URL in the brief now returns *"This API version has been deprecated… migrate to v5"*. The app uses v5 (`https://api.restcountries.com/countries/v5/name?q=…`), which:
- needs a free API key (Free plan: 1,000 requests/month), sent as `Authorization: Bearer <key>`
- blocks browser requests unless the page's hostname is allowed on the key
- returns `data.objects[]` with `names.common`, `capitals[].coordinates.{lat,lng}`, `currencies[]`, `flag.url_png`, `population`, `region`

The key is visible in client code. That is acceptable here because it is free, rate-limited and locked to our hostnames. A production app would proxy it through a Cloud Function, which needs the paid Blaze plan.

### Firebase
- **Auth:** Google sign-in (popup) or email/password. `onAuthStateChanged` switches between the sign-in screen and the app.
- **Firestore data model:** `users/{uid}/trips/{tripId}`
  ```
  { country: {name, officialName, flagUrl, capital, population, region, currency, lat, lng, ...},
    weatherAtSave: {temperature, tempUnit, windSpeed, windUnit, time} | null,
    month: "2026-12", note: "…", createdAt, updatedAt }
  ```
  Storing trips under the user's uid makes the security rule simple, and no cross-user query is possible.
- **CRUD:** `addDoc` (Save Trip), `getDocs` ordered by `createdAt` (My Trips), `updateDoc` (Edit note), `deleteDoc` (Delete).
- **Rules:** only `request.auth.uid == uid` may read or write. Writes must have a string `month` and a string `note` of 500 characters or fewer.
- User text is rendered with `textContent`, never `innerHTML`, so a note can't inject HTML.

## Setup & deploy

1. **Firebase project:** create one at https://console.firebase.google.com (Spark plan).
   - Build → **Authentication** → Get started → enable **Google** and **Email/Password**.
   - Build → **Firestore Database** → Create database (production mode, any region).
   - Project settings → Your apps → add a **Web app** → copy the config into `public/config.js`.
2. **REST Countries key:** sign up at https://restcountries.com/sign-up. On https://restcountries.com/api-keys, allow these hostnames: `localhost`, `<project-id>.web.app`, `<project-id>.firebaseapp.com`. Paste the key into `REST_COUNTRIES_API_KEY` in `public/config.js`.
3. **Deploy** (from this folder):
   ```bash
   npx firebase-tools login
   npx firebase-tools use --add          # pick your project
   npx firebase-tools deploy --only hosting,firestore:rules
   ```
   The site is live at `https://<project-id>.web.app`. Firebase automatically allows that domain for sign-in. If you use a custom domain, add it under Authentication → Settings → Authorized domains.
4. **Run locally:** `npx http-server public -p 5173`, then open http://localhost:5173.

## AI usage
Built with Claude Code. AI wrote the first draft. I then checked it against the live APIs, which showed that REST Countries v3.1 is deprecated and that v5 needs a key and CORS allow-listing. I inspected the real v5 response shape to map the fields, and tested the country → weather chain in Node and in the browser.
