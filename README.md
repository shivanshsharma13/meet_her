# Our Little Room 💗

A private video calling app for exactly two people. It's hosted on GitHub Pages, works in the browser on a PC, and installs like an app on Android phones and tablets. Firebase (free plan) handles Google sign-in and the realtime data.

**Phase 1 (done):** Google sign-in limited to your two emails, presence, video calls (ring, answer or decline on any of her devices), tap-to-touch with vibration, floating emoji reactions, photo booth polaroids saved to a shared memory wall, "thinking of you" nudges, mute, camera off, flip camera, mic-only fallback, screen kept awake during calls.

**Phase 2 (done):** tap 🎲 during a call to play together. Draw on the call, couple quiz (scores are saved), truth or dare, would you rather, pictionary, and watch or listen to YouTube in sync. In-call activities travel over a direct WebRTC data channel between your two devices.

## One-time Firebase setup (about 5 minutes)

1. Go to https://console.firebase.google.com → **Create a project** (any name; you can turn off Google Analytics).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable → Save.**
3. Still in Authentication: **Settings → Authorized domains → Add domain** → `shivanshsharma13.github.io`.
4. **Build → Realtime Database → Create database** → pick a location → **Start in locked mode**.
5. Open the **Rules** tab, paste in the contents of [`database.rules.json`](database.rules.json), replace `YOUR_EMAIL@gmail.com` and `HER_EMAIL@gmail.com` with your two Google emails, and click **Publish**. Only those two accounts can read or write anything.
6. **Project settings (gear icon) → General → Your apps → Web (`</>`)** → register an app (no hosting needed). Copy the `firebaseConfig` values into [`public/config.js`](public/config.js). They aren't secret; the rules above are what keeps the room private.
7. Commit and push. GitHub Actions publishes the site to https://shivanshsharma13.github.io/meet_her/.

Keep the real emails only in the Firebase console, not in this public repo.

## Installing on her phone or tablet

Open https://shivanshsharma13.github.io/meet_her/ in Chrome → sign in with Google → Chrome menu (⋮) → **Add to Home screen**.

## Running locally

```bash
npm run dev
```

Then open http://localhost:3000 (`localhost` is allowed by Firebase by default).

### If calls don't connect on mobile data

Some networks block direct connections. Get free TURN credentials (Metered or Cloudflare) and add them to `iceServers` in `public/config.js`.

## Roadmap

- **Phase 3, between calls:** push notifications (calls and nudges reach her even when the app is closed), countdown, time-locked love notes, daily question, call streak and stats, mood status.
- **Phase 4, polish:** face filters, date-night themes with ambient sound, sleep call mode, birthday and anniversary surprises.
