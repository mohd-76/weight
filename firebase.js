
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

// ==========================================
// FIREBASE CONFIGURATION
// ==========================================

const firebaseConfig = {
  apiKey: 'AIzaSyARaH4EwRYBHPXq1tBsD4RwxovFI-5i2cw',
  authDomain: 'weighttrack-cc98f.firebaseapp.com',
  projectId: 'weighttrack-cc98f',
  storageBucket: 'weighttrack-cc98f.firebasestorage.app',
  messagingSenderId: '538324316957',
  appId: '1:538324316957:web:64b8b01c48390473e7a7f4',
  measurementId: 'G-KDMSL9R2Z4'
};

// ==========================================
// INITIALIZE FIREBASE
// ==========================================

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const provider = new GoogleAuthProvider();

provider.setCustomParameters({
  prompt: 'select_account'
});

// ==========================================
// APP VARIABLES
// ==========================================

let activeUser = null;
let cloudReady = false;
let writeTimer = null;
let unsubscribeDocument = null;
let applyingCloudState = false;

// ==========================================
// DEFAULT EMPTY TRACKER
// ==========================================

function createEmptyState(user) {
  return {
    profile: {
      name: user?.displayName || '',
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
}

// ==========================================
// STATUS EVENTS
// ==========================================

function emitStatus(user, message) {
  window.dispatchEvent(
    new CustomEvent('weighttrack:cloud-status', {
      detail: {
        user,
        message
      }
    })
  );
}

// ==========================================
// LOAD CLOUD DATA INTO APP
// ==========================================

function emitCloudState(data) {
  applyingCloudState = true;

  window.dispatchEvent(
    new CustomEvent('weighttrack:cloud-load', {
      detail: data
    })
  );

  queueMicrotask(() => {
    applyingCloudState = false;
  });
}

// ==========================================
// GOOGLE SIGN IN
// ==========================================

async function signIn() {
  try {
    emitStatus(null, 'Opening Google sign-in...');

    await signInWithPopup(auth, provider);

  } catch (error) {
    console.error('Google sign-in failed:', error);

    emitStatus(
      null,
      `Sign-in failed: ${friendlyError(error)}`
    );
  }
}

// ==========================================
// FRIENDLY ERROR MESSAGES
// ==========================================

function friendlyError(error) {
  const code = error?.code || '';

  if (code === 'auth/unauthorized-domain') {
    return 'This website domain is not authorized in Firebase Authentication.';
  }

  if (code === 'auth/popup-blocked') {
    return 'Your browser blocked the popup. Allow popups and try again.';
  }

  if (code === 'auth/popup-closed-by-user') {
    return 'The sign-in window was closed before completion.';
  }

  if (
    code === 'permission-denied' ||
    code === 'firestore/permission-denied'
  ) {
    return 'Firestore denied access. Check your security rules.';
  }

  if (
    error?.message?.includes('client is offline') ||
    code === 'unavailable'
  ) {
    return 'Unable to connect to Firebase. Check your internet connection and try again.';
  }

  return error?.message || 'Something went wrong. Please try again.';
}

// ==========================================
// GOOGLE SIGN OUT
// ==========================================

async function signOutUser() {
  try {
    cloudReady = false;

    clearTimeout(writeTimer);

    if (unsubscribeDocument) {
      unsubscribeDocument();
      unsubscribeDocument = null;
    }

    await signOut(auth);

  } catch (error) {
    console.error('Sign-out failed:', error);

    emitStatus(
      activeUser,
      `Could not sign out: ${friendlyError(error)}`
    );
  }
}

// ==========================================
// SAVE DATA TO CLOUD
// ==========================================

function scheduleCloudSave(data) {
  if (
    !activeUser ||
    !cloudReady ||
    applyingCloudState
  ) {
    return;
  }

  const userId = activeUser.uid;

  clearTimeout(writeTimer);

  writeTimer = setTimeout(async () => {

    // Make sure the same account is still active.
    if (
      !activeUser ||
      activeUser.uid !== userId ||
      auth.currentUser?.uid !== userId ||
      !cloudReady
    ) {
      return;
    }

    try {
      const userRef = doc(db, 'users', userId);

      await setDoc(
        userRef,
        {
          appData: data,
          updatedAt: serverTimestamp()
        },
        {
          merge: true
        }
      );

      if (auth.currentUser?.uid === userId) {
        emitStatus(
          activeUser,
          'All changes synced to your Google account.'
        );
      }

    } catch (error) {
      console.error('Cloud save failed:', error);

      emitStatus(
        activeUser,
        `Cloud sync error: ${friendlyError(error)}`
      );
    }

  }, 650);
}

// ==========================================
// LISTEN FOR APP DATA CHANGES
// ==========================================

window.addEventListener(
  'weighttrack:local-change',
  event => {
    scheduleCloudSave(event.detail);
  }
);

// ==========================================
// BUTTON EVENTS
// ==========================================

document
  .getElementById('authButton')
  ?.addEventListener('click', () => {
    if (activeUser) {
      signOutUser();
    } else {
      signIn();
    }
  });

document
  .getElementById('signOutButton')
  ?.addEventListener('click', signOutUser);

// ==========================================
// AUTHENTICATION STATE LISTENER
// ==========================================

onAuthStateChanged(auth, async user => {

  // Stop previous account's pending operations.
  cloudReady = false;

  clearTimeout(writeTimer);

  if (unsubscribeDocument) {
    unsubscribeDocument();
    unsubscribeDocument = null;
  }

  activeUser = user;

  // ========================================
  // SIGNED OUT
  // ========================================

  if (!user) {
    emitStatus(
      null,
      'Signed out. Sign in to access your personal cloud tracker.'
    );

    return;
  }

  const userId = user.uid;

  emitStatus(
    user,
    'Loading your personal cloud data...'
  );

  // Immediately clear old account data from the interface.
  // This prevents another account's data appearing while loading.
  emitCloudState(createEmptyState(user));

  // Each Google account has a separate document.
  const userRef = doc(db, 'users', userId);

  try {

    // ======================================
    // FETCH THIS ACCOUNT'S FIRESTORE DATA
    // ======================================

    const snapshot = await getDoc(userRef);

    // Ignore results if the user switched accounts.
    if (auth.currentUser?.uid !== userId) {
      return;
    }

    if (
      snapshot.exists() &&
      snapshot.data().appData
    ) {

      // Existing account: restore its own data.
      emitCloudState(snapshot.data().appData);

      emitStatus(
        user,
        'Your personal tracker data has been restored.'
      );

    } else {

      // New account: create a completely fresh tracker.
      // DO NOT COPY DATA FROM LOCAL STORAGE.

      const emptyState = createEmptyState(user);

      await setDoc(userRef, {
        appData: emptyState,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      if (auth.currentUser?.uid !== userId) {
        return;
      }

      emitCloudState(emptyState);

      emitStatus(
        user,
        'Your new personal tracker is ready.'
      );
    }

    // ======================================
    // ENABLE CLOUD SAVING
    // ======================================

    cloudReady = true;

    // ======================================
    // REAL-TIME CLOUD SYNC
    // ======================================

    unsubscribeDocument = onSnapshot(
      userRef,

      docSnapshot => {

        // Ignore updates belonging to another account.
        if (auth.currentUser?.uid !== userId) {
          return;
        }

        if (!docSnapshot.exists()) {
          return;
        }

        const cloudData = docSnapshot.data().appData;

        if (cloudData) {
          emitCloudState(cloudData);
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

    cloudReady = false;

    emitStatus(
      user,
      `Firebase connection failed: ${friendlyError(error)}`
    );
  }
});
