import { supabase } from "./supabase.js";

export async function getCurrentAdmin() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function isLoggedIn() {
  const user = await getCurrentAdmin();
  return user !== null;
}

export async function signUp(name, email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: name } },
  });
  if (error) return { ok: false, error: error.message };
  // Supabase sends a confirmation email by default.
  // If you have email confirmation disabled in your project, the user is signed in immediately.
  return { ok: true, confirmEmail: !data.session };
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: error.message };
  return { ok: true, user: data.user };
}

export async function signOut() {
  await supabase.auth.signOut();
}

// Listen for auth state changes (call this once on app init)
export function onAuthChange(callback) {
  supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
}
