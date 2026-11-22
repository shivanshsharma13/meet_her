// Paste your Firebase web app config here (Firebase console → Project settings → General → Your apps).
// These values are not secret: who can get in is decided by the database rules (database.rules.json).
export const firebaseConfig = {
  apiKey: 'AIzaSyDj6e_ZmFuHvr5PDwT_6GJmpe7Fyc72kPY',
  authDomain: 'meet-her-7fdde.firebaseapp.com',
  databaseURL: 'https://meet-her-7fdde-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'meet-her-7fdde',
  appId: '1:83488240402:web:6f9980144f93dadbeb39cb',
};

// Servers that help two devices find each other. Add a TURN server here if calls
// can't connect on mobile data (see README).
export const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
