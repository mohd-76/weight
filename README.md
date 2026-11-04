# WeightTrack — Frontend v1

A responsive, mobile-first weight tracker built with HTML, CSS, vanilla JavaScript and Chart.js.

## Run it

1. Download and unzip the project.
2. Open `index.html` in a modern browser. For the most reliable browser APIs, serve the folder from a local web server instead of opening it as a `file://` URL.
   - VS Code: install/use Live Server, then choose **Open with Live Server**.
   - Or, with Python installed, run `python -m http.server 8000` inside this folder and visit `http://localhost:8000`.
3. Open **Goals & reminders** to set your starting weight, target, weigh-in days and reminder preferences.

## Included in this frontend version

- Responsive dashboard with light/dark theme.
- Add, edit and delete weigh-ins.
- Weight history and CSV export.
- Weight trend chart with 7-day, 30-day, 90-day and all-time filters.
- Goal progress, milestones and planned weigh-in consistency.
- Custom weigh-in days and daily targets.
- Browser notification permission and reminders while the app is open.
- Local browser storage so data remains in the same browser on the same device.

## Important current limitations

- Google sign-in and Firebase cloud sync are **not connected yet**. This first version saves data in the current browser using `localStorage`; it does not sync across devices or Google accounts.
- Browser notifications in this version are checked while the app page is open. Reliable reminders while the browser is closed require a service worker plus a push-notification backend (for example Firebase Cloud Messaging).
- Chart.js and Google Fonts are loaded from CDNs, so an internet connection is required for those assets.

## Next development step: Firebase

1. Create a Firebase project and register a Web App.
2. Enable Google under Authentication → Sign-in method.
3. Create a Firestore database.
4. Add the Firebase web configuration to the app.
5. Implement Google sign-in, sign-out and per-user Firestore reads/writes.
6. Add Firestore security rules so each signed-in user can access only their own profile, entries and task data.
7. Migrate this browser's local data to the signed-in user's cloud account, with an explicit merge choice if cloud data already exists.

Do not publish Firebase service-account credentials in frontend code. The web app only needs the public Firebase web-app configuration; access must be protected by Authentication and Firestore Security Rules.

## Firebase integration (Phase 2)

This version includes Google sign-in and Firestore cloud sync for each authenticated user.

### Firebase Console setup

1. In Firebase Console, open **Authentication → Settings → Authorized domains** and add the domain where you will host the app. For local testing, add `localhost` if it is not already listed.
2. Under **Authentication → Sign-in method**, enable **Google** and choose a support email.
3. Create a **Cloud Firestore** database.
4. Open Firestore **Rules**, replace the rules with the contents of `firestore.rules`, and click **Publish**.
5. Run the project using VS Code Live Server (`http://localhost:5500`) or deploy it to Firebase Hosting. Do not open `index.html` as a `file://` URL; ES modules and Google sign-in need an HTTP(S) origin.
6. Click **Sign in with Google** in WeightTrack. On the first sign-in, existing browser data is migrated to that Google account. On later sign-ins, that account's cloud data is restored.

### Data and security notes

- Firestore stores one document at `users/{uid}` with the user's WeightTrack app state in `appData`.
- The supplied rules allow a signed-in user to access only the document whose ID matches their Firebase Authentication UID.
- A local backup is kept under `weighttrack_v1_precloud_backup` before existing local data is replaced by a previously populated cloud account.
- The Firebase web configuration in `firebase.js` is public client configuration. Never put service-account private keys in frontend code.
- This is an initial cloud-sync implementation. For very large histories, data should later be split into per-entry documents rather than keeping all entries in one Firestore document.

### Current notification limitation

Daily and weigh-in reminders are still checked by the browser while the app is open. Background push notifications when the browser is closed are a separate phase requiring a service worker and a trusted push sender (for example Cloud Functions plus Firebase Cloud Messaging).


## Goals update (v3)

- Weekly goals: create custom goals such as “Strength workouts” with a target count per week, then use + / − controls to track progress.
- Automatic weekly weigh-in goal: the app uses the number of selected weigh-in days as the weekly target and counts unique weigh-in dates automatically.
- Daily custom targets can be set to repeat automatically on future days or stay as a one-day task.
- New daily and weekly goal data is included in the existing app state and therefore syncs through the current Firestore cloud document after sign-in.

Weekly custom-goal progress is tracked by Monday-starting calendar weeks. Daily targets are checked off separately for each date.

## Custom dated weight targets (v4)

- Open **Goals & reminders → Custom weight targets**.
- Add any date and a target weight. There is no required frequency: users can add Thursday/Sunday targets, daily targets, or irregular dates.
- Each date can have one planned target. Duplicate dates are prevented; edit the existing target to change it.
- A target stays **Pending** until a weigh-in is recorded for that exact date. A later weigh-in is never substituted for a missed date.
- When an exact-date weigh-in exists, the table shows actual weight and the difference (actual minus target). Negative means the actual weight is below the planned target; positive means it is above.
- The main weight trend chart now overlays planned targets against actual weigh-ins. The new schedule is saved in the same app state and syncs through Firestore.
- Existing accounts and local data are retained; the new `targetSchedule` field is added automatically when the app loads older saved data.
