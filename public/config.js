// Paste your Firebase web app config here (Firebase console → Project settings → General → Your apps).
// These values are not secret: who can get in is decided by the database rules (database.rules.json).
export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  databaseURL: '',
  projectId: '',
  appId: '',
};

// Servers that help two devices find each other. Add a TURN server here if calls
// can't connect on mobile data (see README).
export const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
