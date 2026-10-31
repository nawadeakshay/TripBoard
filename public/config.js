// Paste your Firebase web app config here.
// Firebase console → Project settings → General → Your apps → Web app → "Config".
// These values are not secrets: access to data is enforced by firestore.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyBSOfvWFRfU1BiPlZCPjXx0S4zbp8AQziw",
  authDomain: "tripboard-31aaf.firebaseapp.com",
  projectId: "tripboard-31aaf",
  storageBucket: "tripboard-31aaf.firebasestorage.app",
  messagingSenderId: "1012686504284",
  appId: "1:1012686504284:web:f7a2a1aa0e7ab7a375c199",
};

// REST Countries v3.1 is deprecated; v5 needs a free API key (https://restcountries.com/sign-up).
// In the key's settings, allow your hosting hostnames (e.g. localhost, <project>.web.app),
// because browser calls are blocked for origins the key doesn't allow.
// ("rc_live_demo" only returns one sample country, Canada.)
export const REST_COUNTRIES_API_KEY = "rc_live_c0403f793e6f4d6396942ac458061c63";
