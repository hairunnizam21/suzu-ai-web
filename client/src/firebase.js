import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyA4rjkkbWgr34MU89jqCxG45Vuurbt51mM",
  authDomain: "suzu-ai-39dc5.firebaseapp.com",
  projectId: "suzu-ai-39dc5",
  storageBucket: "suzu-ai-39dc5.firebasestorage.app",
  messagingSenderId: "462046414588",
  appId: "1:462046414588:web:4675f00d7ef130190ab979",
  measurementId: "G-G4HSME4EM8"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export async function loginWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function logout() {
  await signOut(auth);
}

export async function getIdToken() {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

export { auth };
