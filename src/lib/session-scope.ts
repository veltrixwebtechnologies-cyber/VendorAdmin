// Clears any persisted Supabase auth session on every page load so the app
// never auto-logs the user in. The user must explicitly sign in each time
// they open or reload the site. In-app SPA navigations do NOT re-run this
// module, so an active session persists across route changes within the
// same page load.
if (typeof window !== "undefined") {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sb-") && k.includes("-auth-token")) {
        localStorage.removeItem(k);
      }
    }
  } catch {
    // storage may be unavailable (private mode, SSR); ignore
  }
}

export {};
