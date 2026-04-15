import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyC324eUVS7VSgrJ-EiWkKH9PAoOM9ypvB0",
  authDomain: "automation-app-crm.firebaseapp.com",
  projectId: "automation-app-crm",
  storageBucket: "automation-app-crm.firebasestorage.app",
  messagingSenderId: "427539422773",
  appId: "1:427539422773:web:27bd63e5b62ed7a7b25b7c"
};

const app = initializeApp(firebaseConfig);

// App Check — loaded dynamically so a failure can't break the app
import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js")
  .then(({ initializeAppCheck, ReCaptchaEnterpriseProvider }) => {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider('6Ld_1rcsAAAAAJXP7udmGMNbWxCcsui1m-VwCo1U'),
      isTokenAutoRefreshEnabled: true
    });
  })
  .catch(err => console.error('App Check init failed:', err));

const db = getFirestore(app);
const auth = getAuth(app);

export { db, auth };
