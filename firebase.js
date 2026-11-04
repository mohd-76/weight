
// WeightTrack Firebase integration
// Firebase JS SDK modular v10.14.1

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

import {
  initializeFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// Firebase configuration
const firebaseConfig = {
  apiKey: 'AIzaSyARaH4EwRYBHPXq1tBsD4RwxovFI-5i2cw',
  authDomain: 'weighttrack-cc98f.firebaseapp.com',
  projectId: 'weighttrack-cc98f',
  storageBucket: 'weighttrack-cc98f.firebasestorage.app',
  messagingSenderId: '538324316957',
  appId: '1:538324316957:web:64b8b01c48390473e7a7f4',
  measurementId: 'G-KDMSL9R2Z4'
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Authentication
const auth = getAuth(app);

// Initialize Firestore with Long Polling
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true
});

// Google Authentication
const provider = new GoogleAuthProvider();
provider.setCustomParameters({
  prompt: 'select_account'
});

const STORAGE_KEY = 'weighttrack_v1';

let activeUser = null;
let cloudReady = false;
let writeTimer = null;
let unsubscribeDocument = null;
let applyingCloudState = false;

// Cloud status
const emitStatus = (user, message) => {
  window.dispatchEvent(
    new CustomEvent('weighttrack:cloud-status', {
      detail: { user, message }
    })
  );
};

// Get local data
const localState = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch (_) {
    return null;
  }
};

// Load cloud data into app
const emitCloudState = data => {
  applyingCloudState = true;

  window.dispatchEvent(
    new CustomEvent('weighttrack:cloud-load', {
      detail: data
    })
  );

  queueMicrotask(() => {
    applyingCloudState = false;
  });
};

// Friendly Firebase errors
function friendlyError(error) {
  const code = error?.code || '';

  if (code === 'auth/unauthorized-domain') {
    return 'This website domain is not authorized in Firebase Authentication settings.';
  }

  if (code === 'auth/popup-blocked') {
    return 'Your browser blocked the sign-in popup. Allow popups and try again.';
  }

  if (code === 'auth/popup-closed-by-user') {
    return 'The sign-in window was closed before completion.';
  }

  if (code === 'permission-denied' ||
      code === 'firestore/permission-denied') {
    return 'Firestore denied access. Check your security rules.';
  }

  return error?.message || 'Please try again.';
}

// Google sign-in
async function signIn() {
  try {
    emitStatus(null, 'Opening Google sign-in…');

    await signInWithPopup(auth, provider);

  } catch (error) {
    console.error('Google sign-in failed:', error);

    emitStatus(
      null,
      `Sign-in failed: ${friendlyError(error)}`
    );
  }
}

// Sign out
async function signOutUser() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error(error);

    emitStatus(
      activeUser,
      `Could not sign out: ${friendlyError(error)}`
    );
  }
}

// Save data to Firestore
function scheduleCloudSave(data) {
  if (!activeUser || !cloudReady || applyingCloudState) {
    return;
  }

  clearTimeout(writeTimer);

  writeTimer = setTimeout(async () => {
    try {
      const ref = doc(db, 'users', activeUser.uid);

      await setDoc(
        ref,
        {
          appData: data,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );

      emitStatus(
        activeUser,
        'All changes synced to your Google account.'
      );

    } catch (error) {
      console.error('Cloud save failed:', error);

      emitStatus(
        activeUser,
        `Cloud sync error: ${friendlyError(error)}`
      );
    }
  }, 650);
}

// Listen for local app changes
window.addEventListener('weighttrack:local-change', event => {
  scheduleCloudSave(event.detail);
});

// Authentication buttons
document.getElementById('authButton')
  ?.addEventListener('click', () => {
    activeUser ? signOutUser() : signIn();
  });

document.getElementById('signOutButton')
  ?.addEventListener('click', signOutUser);

// Authentication state listener
onAuthStateChanged(auth, async user => {
  activeUser = user;
  cloudReady = false;

  clearTimeout(writeTimer);

  if (unsubscribeDocument) {
    unsubscribeDocument();
    unsubscribeDocument = null;
  }

  if (!user) {
    emitStatus(
      null,
      'Signed out. Your existing browser data remains on this device.'
    );

    return;
  }

  emitStatus(
    user,
    'Connecting to your private cloud storage…'
  );

  const ref = doc(db, 'users', user.uid);

  try {
    const snapshot = await getDoc(ref);

    if (snapshot.exists() && snapshot.data().appData) {

      // Backup existing local data
      const existingLocal = localState();

      if (existingLocal) {
        localStorage.setItem(
          `${STORAGE_KEY}_precloud_backup`,
          JSON.stringify(existingLocal)
        );
      }

      // Restore cloud data
      emitCloudState(snapshot.data().appData);

      emitStatus(
        user,
        'Your cloud data has been restored on this device.'
      );

    } else {

      // Migrate existing local data
      const currentLocal = localState();

      if (currentLocal) {

        await setDoc(
          ref,
          {
            appData: currentLocal,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          },
          { merge: true }
        );

      } else {

        // First-time user
        const emptyState = {
          profile: {
            name: user.displayName || '',
            unit: 'kg',
            heightCm: '',
            startWeight: null,
            targetWeight: null,
            targetDate: '',
            weeklyRate: 0.5,
            weighDays: [4, 0],
            weighTime: '08:00',
            dailyReminder: false,
            dailyTime: '09:00',
            notificationsEnabled: false,
            theme: 'light',
            setupComplete: false
          },

          entries: [],
          tasksByDate: {},
          reminderLog: {}
        };

        await setDoc(
          ref,
          {
            appData: emptyState,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          },
          { merge: true }
        );

        emitCloudState(emptyState);
      }

      emitStatus(
        user,
        'Your existing tracker data has been backed up to the cloud.'
      );
    }

    // Enable cloud synchronization
    cloudReady = true;

    // Listen for cloud changes
    unsubscribeDocument = onSnapshot(
      ref,

      docSnapshot => {
        if (!docSnapshot.exists()) return;

        const data = docSnapshot.data().appData;

        if (data) {
          emitCloudState(data);
        }
      },

      error => {
        console.error('Cloud listener error:', error);

        emitStatus(
          user,
          `Cloud sync error: ${friendlyError(error)}`
        );
      }
    );

  } catch (error) {

    console.error('Firebase setup failed:', error);

    emitStatus(
      user,
      `Firebase connection failed: ${friendlyError(error)}`
    );
  }
});
