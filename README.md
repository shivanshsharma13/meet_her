# Our Little Room 💗

A private video calling app for exactly two people. It runs in the browser on a PC and installs like an app on Android phones and tablets.

**Phase 1 (done):** passcode login, presence, video calls (ring, answer or decline on any of her devices), tap-to-touch with vibration, floating emoji reactions, photo booth polaroids saved to a shared memory wall, "thinking of you" nudges, mute, camera off, flip camera, screen kept awake during calls.

## Run it on your PC

```bash
npm install
cp .env.example .env   # then set both names and two different passcodes
npm start
```

Open http://localhost:3000. Each person logs in with their own passcode.

## Test with her phone on the same Wi-Fi

Phones only allow camera access over HTTPS, so start the HTTPS version:

```bash
npm run start:https
```

On the phone, open `https://<your-PC's-IP>:3443` (find the IP with `hostname -I`). Chrome shows a certificate warning because the certificate is self-signed: tap **Advanced → Proceed**.

## Put it online so it works from anywhere

Deploy to any Node host that supports WebSockets, for example [Render](https://render.com) (free tier):

1. Push this folder to a private GitHub repo.
2. On Render: New → Web Service → choose the repo. Build command `npm install`, start command `npm start`.
3. Under Environment, add `USER1_NAME`, `USER1_PASS`, `USER2_NAME`, `USER2_PASS`.
4. Open the `https://…onrender.com` URL on her phone, then Chrome menu → **Add to Home screen**.

Free Render instances sleep when idle and reset their disk on redeploy, so memory photos can be lost. Attach a persistent disk and set `DATA_DIR` to its path to keep them.

### If calls don't connect on mobile data

Some networks block direct connections. Get free TURN credentials (Metered or Cloudflare) and set `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` (see `.env.example`).

## Roadmap

- **Phase 2, play:** shared drawing on the call, mini games (couple quiz, truth or dare, would you rather, pictionary), watch YouTube together, listen to music together.
- **Phase 3, between calls:** push notifications (calls and nudges reach her even when the app is closed), countdown, time-locked love notes, daily question, call streak and stats, mood status.
- **Phase 4, polish:** face filters, date-night themes with ambient sound, sleep call mode, birthday and anniversary surprises.
