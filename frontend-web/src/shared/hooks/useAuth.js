import { useEffect, useState } from 'react';
import { supabase, supabaseConfigError } from '../supabase';

/**
 * Custom hook to manage Supabase Authentication state.
 */
export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      if (supabaseConfigError) {
        console.error('Supabase configuration error:', supabaseConfigError);
      }
      setUser(null);
      setLoading(false);
      return;
    }

    // 1. Get the current user session immediately
    const fetchSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.error('Failed to get auth session:', error);
          setUser(null);
          return;
        }
        setUser(data.session?.user ?? null);
      } catch (err) {
        console.error('Unexpected error while initializing auth session:', err);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    
    fetchSession();

    // 2. Listen for login/logout events
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED') {
        setUser(session?.user ?? null);
      } else if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESH_FAILED') {
        setUser(null);
      } else {
        setUser(session?.user ?? null);
      }
      setLoading(false);
    });

    return () => {
      if (listener?.subscription) {
        listener.subscription.unsubscribe();
      }
    };
  }, []);

  return { user, loading };
}
