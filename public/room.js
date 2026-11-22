// Everything that talks to Firebase: Google sign-in, presence, call signaling and memories.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithCredential, signOut, onAuthStateChanged, connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js';
import {
  getDatabase, ref, push, set, get, remove, update, onValue, onChildAdded, onChildRemoved, onDisconnect,
  serverTimestamp, increment, query, orderByChild, startAt, endAt, limitToLast, connectDatabaseEmulator,
} from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-database.js';
import { firebaseConfig } from './config.js';

// ?emulator=1 points the app at a local Firebase emulator (used for testing).
const useEmulator = new URLSearchParams(location.search).has('emulator');
const config = useEmulator
  ? { apiKey: 'demo', projectId: 'demo-room', databaseURL: 'http://127.0.0.1:9000?ns=demo-room-default-rtdb' }
  : firebaseConfig;

export const isConfigured = Boolean(config.apiKey && config.databaseURL);

let auth;
let db;
if (isConfigured) {
  const app = initializeApp(config);
  auth = getAuth(app);
  db = getDatabase(app);
  if (useEmulator) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectDatabaseEmulator(db, '127.0.0.1', 9000);
  }
}

export const onUser = (callback) => onAuthStateChanged(auth, callback);
export const signIn = () => signInWithPopup(auth, new GoogleAuthProvider());

// Emulator only: sign in as a made-up Google account without the popup.
export const signInForTest = (email) => signInWithCredential(
  auth,
  GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true, name: email.split('@')[0] })),
);

let session = null;

// Joins the room and reports everything that happens through `on`:
// on.partner({ uid, name }), on.presence(online), on.message(msg), on.memory(memory)
export async function joinRoom(user, on) {
  const uid = user.uid;
  // Throws PERMISSION_DENIED for anyone whose email isn't in the database rules.
  const mine = await get(ref(db, `users/${uid}`));
  if (!mine.exists()) {
    await set(ref(db, `users/${uid}`), { name: (user.displayName || user.email || 'Me').split(' ')[0] });
  }

  const offset = await new Promise((resolve) => {
    onValue(ref(db, '.info/serverTimeOffset'), (snap) => resolve(snap.val() || 0), { onlyOnce: true });
  });
  const serverNow = () => Date.now() + offset;

  const conn = push(ref(db, `presence/${uid}`)).key; // this device
  const presenceRef = ref(db, `presence/${uid}/${conn}`);
  const s = { uid, conn, presenceRef, partnerUid: null, unsubs: [] };
  session = s;
  const listen = (unsub) => s.unsubs.push(unsub);

  listen(onValue(ref(db, '.info/connected'), async (snap) => {
    if (!snap.val() || session !== s) return;
    await onDisconnect(presenceRef).remove();
    await set(presenceRef, { at: serverTimestamp() });
  }));

  // Clear out old signaling messages so the inbox doesn't grow forever.
  const old = await get(query(ref(db, `inbox/${uid}`), orderByChild('at'), endAt(serverNow() - 3_600_000)));
  if (old.exists()) await update(ref(db, `inbox/${uid}`), Object.fromEntries(Object.keys(old.val()).map((k) => [k, null])));

  // Only messages sent from now on; skip my own and ones meant for my other devices.
  listen(onChildAdded(query(ref(db, `inbox/${uid}`), orderByChild('at'), startAt(serverNow())), (snap) => {
    const msg = snap.val();
    if (msg.from === conn || (msg.to && msg.to !== conn)) return;
    on.message(msg);
  }));

  let partnerUnsubs = [];
  listen(onValue(ref(db, 'users'), (snap) => {
    const users = snap.val() || {};
    const me = users[uid];
    const partnerUid = Object.keys(users).find((id) => id !== uid) || null;
    on.me({ uid, name: me?.name });
    if (partnerUid === s.partnerUid) return on.partner(partnerUid && { uid: partnerUid, name: users[partnerUid].name });
    s.partnerUid = partnerUid;
    partnerUnsubs.forEach((u) => u());
    partnerUnsubs = [];
    on.partner(partnerUid && { uid: partnerUid, name: users[partnerUid].name });
    if (!partnerUid) return on.presence(false);
    const theirPresence = ref(db, `presence/${partnerUid}`);
    partnerUnsubs.push(
      onValue(theirPresence, (p) => on.presence(p.exists())),
      onChildRemoved(theirPresence, (p) => on.message({ type: 'conn-gone', conn: p.key })),
    );
  }));
  listen(() => partnerUnsubs.forEach((u) => u()));

  listen(onChildAdded(query(ref(db, 'memories'), limitToLast(300)), (snap) => {
    on.memory({ id: snap.key, ...snap.val() });
  }));
}

export async function leaveRoom() {
  if (!session) return;
  const s = session;
  session = null;
  s.unsubs.forEach((u) => u());
  await remove(s.presenceRef).catch(() => {});
  await onDisconnect(s.presenceRef).cancel().catch(() => {});
  await signOut(auth);
}

// Sends a message to the partner's devices (or one device with `to`),
// or to my own other devices with `scope: 'self'`.
export function send({ to, scope, ...msg }) {
  const s = session;
  const target = scope === 'self' ? s?.uid : s?.partnerUid;
  if (!target) return;
  const payload = JSON.parse(JSON.stringify({ ...msg, to: to || null, from: s.conn }));
  push(ref(db, `inbox/${target}`), { ...payload, at: serverTimestamp() });
}

export async function saveMemory({ caption, image, thumb }) {
  const memoryRef = push(ref(db, 'memories'));
  await set(ref(db, `memoryImages/${memoryRef.key}`), image);
  await set(memoryRef, { caption, thumb, by: session.uid, at: serverTimestamp() });
}

// Couple quiz points, kept forever: quizScores/{uid} = number of correct guesses.
export const addQuizPoint = (uid) => set(ref(db, `quizScores/${uid}`), increment(1));
export const watchQuizScores = (callback) => onValue(ref(db, 'quizScores'), (snap) => callback(snap.val() || {}));

export async function loadMemoryImage(id) {
  return (await get(ref(db, `memoryImages/${id}`))).val();
}
