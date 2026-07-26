import { useSyncExternalStore } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
}

// ---- Shared singleton auth store ----------------------------------------
// A single getSession() + one onAuthStateChange listener are shared across
// every consumer, instead of each route mount re-hydrating. This removes
// the perceptible lag when navigating between protected routes.

let state: AuthState = { session: null, user: null, loading: true };
const listeners = new Set<() => void>();
let initialized = false;

function setState(next: AuthState) {
  state = next;
  listeners.forEach((l) => l());
}

function ensureInit() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  supabase.auth.onAuthStateChange((_event, session) => {
    setState({ session, user: session?.user ?? null, loading: false });
  });

  void Promise.race([
    supabase.auth.getSession(),
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 5_000)),
  ])
    .then((result) => {
      if (!result) {
        setState({ session: null, user: null, loading: false });
        return;
      }
      setState({
        session: result.data.session,
        user: result.data.session?.user ?? null,
        loading: false,
      });
    })
    .catch((error) => {
      console.error("[auth] session initialization failed", error);
      setState({ session: null, user: null, loading: false });
    });
}

function subscribe(cb: () => void) {
  ensureInit();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): AuthState {
  return state;
}

const SSR_STATE: AuthState = { session: null, user: null, loading: true };
function getServerSnapshot(): AuthState {
  return SSR_STATE;
}

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export async function signOut() {
  await supabase.auth.signOut();
}
