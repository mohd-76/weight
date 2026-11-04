// WeightTrack Firebase integration (Firebase JS SDK modular v10).
// The Firebase web config is public client configuration. Protect data with Firestore Rules.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyARaH4EwRYBHPXq1tBsD4RwxovFI-5i2cw',
  authDomain: 'weighttrack-cc98f.firebaseapp.com',
  projectId: 'weighttrack-cc98f',
  storageBucket: 'weighttrack-cc98f.firebasestorage.app',
  messagingSenderId: '538324316957',
  appId: '1:538324316957:web:64b8b01c48390473e7a7f4',
  measurementId: 'G-KDMSL9R2Z4'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });
const STORAGE_KEY = 'weighttrack_v1';
let activeUser = null;
let cloudReady = false;
let writeTimer = null;
let unsubscribeDocument = null;
let applyingCloudState = false;

const emitStatus = (user, message) => window.dispatchEvent(new CustomEvent('weighttrack:cloud-status', { detail: { user, message } }));
const localState = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
  catch (_) { return null; }
};
const emitCloudState = data => {
  applyingCloudState = true;
  window.dispatchEvent(new CustomEvent('weighttrack:cloud-load', { detail: data }));
  queueMicrotask(() => { applyingCloudState = false; });
};

async function signIn() {
  try {
    emitStatus(null, 'Opening Google sign-in…');
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error('Google sign-in failed:', error);
    emitStatus(null, `Sign-in failed: ${friendlyError(error)}`);
  }
}

function friendlyError(error) {
  const code = error?.code || '';
  if (code === 'auth/unauthorized-domain') return 'This website domain is not authorized in Firebase Authentication settings.';
  if (code === 'auth/popup-blocked') return 'Your browser blocked the sign-in popup. Allow popups and try again.';
  if (code === 'auth/popup-closed-by-user') return 'The sign-in window was closed before completion.';
  if (code === 'permission-denied' || code === 'firestore/permission-denied') return 'Firestore denied access. Check that the supplied security rules are published.';
  return error?.message || 'Please try again.';
}

async function signOutUser() {
  try { await signOut(auth); }
  catch (error) { console.error(error); emitStatus(activeUser, `Could not sign out: ${friendlyError(error)}`); }
}

function scheduleCloudSave(data) {
  if (!activeUser || !cloudReady || applyingCloudState) return;
  clearTimeout(writeTimer);
  writeTimer = setTimeout(async () => {
    try {
      const ref = doc(db, 'users', activeUser.uid);
      await setDoc(ref, { appData: data, updatedAt: serverTimestamp() }, { merge: true });
      emitStatus(activeUser, 'All changes synced to your Google account.');
    } catch (error) {
      console.error('Cloud save failed:', error);
      emitStatus(activeUser, `Cloud sync error: ${friendlyError(error)}`);
    }
  }, 650);
}

window.addEventListener('weighttrack:local-change', event => scheduleCloudSave(event.detail));

document.getElementById('authButton')?.addEventListener('click', () => activeUser ? signOutUser() : signIn());
document.getElementById('signOutButton')?.addEventListener('click', signOutUser);

onAuthStateChanged(auth, async user => {
  activeUser = user;
  cloudReady = false;
  clearTimeout(writeTimer);
  if (unsubscribeDocument) { unsubscribeDocument(); unsubscribeDocument = null; }

  if (!user) {
    emitStatus(null, 'Signed out. Your existing browser data remains on this device.');
    return;
  }

  emitStatus(user, 'Connecting to your private cloud storage…');
  const ref = doc(db, 'users', user.uid);
  try {
    const snapshot = await getDoc(ref);
    if (snapshot.exists() && snapshot.data().appData) {
      // Keep a recoverable local copy before replacing it with this account's cloud data.
      const existingLocal = localState();
      if (existingLocal) localStorage.setItem(`${STORAGE_KEY}_precloud_backup`, JSON.stringify(existingLocal));
      emitCloudState(snapshot.data().appData);
      emitStatus(user, 'Your cloud data has been restored on this device.');
    } else {
      // First sign-in on this account: migrate this browser's existing tracker data.
      const currentLocal = localState();
      if (currentLocal) {
        await setDoc(ref, { appData: currentLocal, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
      } else {
        const emptyState = {
          profile: { name: user.displayName || '', unit: 'kg', heightCm: '', startWeight: null, targetWeight: null, targetDate: '', weeklyRate: 0.5, weighDays: [4, 0], weighTime: '08:00', dailyReminder: false, dailyTime: '09:00', notificationsEnabled: false, theme: 'light', setupComplete: false },
          entries: [], tasksByDate: {}, reminderLog: {}
        };
        await setDoc(ref, { appData: emptyState, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
        emitCloudState(emptyState);
      }
      emitStatus(user, 'Your existing tracker data has been backed up to the cloud.');
    }

    cloudReady = true;
    unsubscribeDocument = onSnapshot(ref, docSnapshot => {
      if (!docSnapshot.exists()) return;
      const data = docSnapshot.data().appData;
      if (data) emitCloudState(data);
    }, error => {
      console.error('Cloud listener error:', error);
      emitStatus(user, `Cloud sync error: ${friendlyError(error)}`);
    });
  } catch (error) {
    console.error('Firebase setup failed:', error);
    emitStatus(user, `Firebase connection failed: ${friendlyError(error)}`);
  }
});
