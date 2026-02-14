// Firebase Configuration for v8 (Namespaced)
// Compatible with the script tags in your HTML files

const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// Export instances to window so main.js can use them
window.firebaseApp = firebase.app();
window.auth = firebase.auth();
window.db = firebase.firestore();

console.log("Firebase initialized:", window.firebaseApp.name);