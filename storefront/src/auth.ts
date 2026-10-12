import { initializeApp } from 'firebase/app';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  updateProfile, sendEmailVerification, sendPasswordResetEmail, onAuthStateChanged,
  type Auth,
} from 'firebase/auth';

export type AccountUser = { uid: string; name: string; email: string; emailVerified: boolean };
let initialization: Promise<Auth> | null = null;
async function firebaseAuth(): Promise<Auth> {
  if (!initialization) {
    initialization = (async () => {
      const response = await fetch('/auth/config', { cache: 'no-store' });
      const settings = await response.json();
      if (!response.ok || !settings.enabled) throw new Error('Account sign-in is not available yet.');
      const auth = getAuth(initializeApp(settings.config));
      await auth.authStateReady();
      return auth;
    })();
    initialization.catch(() => { initialization = null; });
  }
  return initialization;
}

export const authenticatedFetch: typeof fetch = async (input, init) => {
  const target = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
  if (target.origin !== window.location.origin) throw new Error('Account tokens may only be sent to this site');
  const auth = await firebaseAuth();
  if (!auth.currentUser) throw new Error('Log in to continue');
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
  headers.set('Authorization', 'Bearer ' + await auth.currentUser.getIdToken());
  return fetch(input, { ...init, headers });
};

export async function accountRequest(path: string, init?: RequestInit) {
  const response = await authenticatedFetch(path, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Account request failed');
  return data;
}

export async function loginAccount(email: string, password: string, username?: string): Promise<AccountUser> {
  const auth = await firebaseAuth();
  const credential = username === undefined
    ? await signInWithEmailAndPassword(auth, email.trim(), password)
    : await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (username !== undefined) {
    await updateProfile(credential.user, { displayName: username.trim() });
  }
  await credential.user.getIdToken(true);
  if (credential.user.displayName) {
    await accountRequest('/account/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  }
  if (username !== undefined) await sendEmailVerification(credential.user);
  return (await accountRequest('/account/me')).user;
}

export async function logoutAccount() { await signOut(await firebaseAuth()); }
export async function resetPassword(email: string) {
  await sendPasswordResetEmail(await firebaseAuth(), email.trim());
}
export async function refreshAccount(): Promise<AccountUser> {
  const auth = await firebaseAuth();
  if (!auth.currentUser) throw new Error('Log in to continue');
  await auth.currentUser.reload();
  await auth.currentUser.getIdToken(true);
  return (await accountRequest('/account/me')).user;
}
export async function resendVerification() {
  const auth = await firebaseAuth();
  if (!auth.currentUser) throw new Error('Log in to continue');
  await sendEmailVerification(auth.currentUser);
}
export async function watchAccount(callback: (user: AccountUser | null) => void, onError: (error: Error) => void) {
  const auth = await firebaseAuth();
  let generation = 0;
  return onAuthStateChanged(auth, (user) => {
    const current = ++generation;
    if (!user) callback(null);
    else accountRequest('/account/me').then((data) => {
      if (current === generation && auth.currentUser?.uid === user.uid) callback(data.user);
    }).catch((error) => { if (current === generation) onError(error); });
  });
}
export async function currentAccount(): Promise<AccountUser> {
  return (await accountRequest('/account/me')).user;
}

const portalAuth = { fetch: authenticatedFetch, currentAccount };
declare global { interface Window { FairQueueAuth: typeof portalAuth } }
window.FairQueueAuth = portalAuth;
