// ============================================================
// Firebase Configuration — GrowthApex EMS
// ============================================================
// INSTRUCTIONS:
//   1. Go to https://console.firebase.google.com
//   2. Open your project → Project Settings → Your apps → SDK setup
//   3. Copy the firebaseConfig object and paste it below
// ============================================================

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID",
};

// ── Firebase SDK (via CDN — loaded by the HTML page before this script) ──
// Required script tags in HTML (already added by ems-firebase.js loader):
//   <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"></script>

firebase.initializeApp(firebaseConfig);

const db   = firebase.firestore();
const auth = firebase.auth();

// Enable offline persistence (optional — helps with brief network drops)
db.enablePersistence().catch(err => {
  if (err.code === 'failed-precondition') {
    console.warn('Firebase persistence: multiple tabs open.');
  } else if (err.code === 'unimplemented') {
    console.warn('Firebase persistence: not supported in this browser.');
  }
});
