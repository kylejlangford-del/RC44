/* RC44 — Firebase project config for live Main Battens sync between devices.
 * This is NOT a secret — it just tells the browser which Firebase project to talk to.
 * Access is controlled by Firestore security rules, not by hiding this file.
 *
 * Fill these in from Firebase console → Project settings → Your apps → (web app) → SDK setup.
 * Until REPLACE_ME values are filled in, Main Battens runs in local-only mode (no cross-device sync).
 */
window.RC44_FIREBASE_CONFIG = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.appspot.com",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME"
};
