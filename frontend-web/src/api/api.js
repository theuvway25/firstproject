import axios from "axios";
import { supabase } from "../shared/supabase";

const API = axios.create({
    baseURL: import.meta.env.VITE_PARSER_API_URL || "http://localhost:8000",
});

// Attach the live Supabase JWT automatically on every request
API.interceptors.request.use(async (config) => {
    if (supabase) {
        let token = null;
        try {
            // Read synchronously from local storage using supabase's key
            const sessionKey = supabase.auth.storageKey;
            const sessionJson = sessionKey ? window.localStorage.getItem(sessionKey) : null;
            if (sessionJson) {
                const session = JSON.parse(sessionJson);
                // Check if session exists and is not expired (add a 10s buffer)
                if (session && session.access_token && session.expires_at) {
                    const expiresAtMs = session.expires_at * 1000;
                    if (expiresAtMs > Date.now() + 10000) {
                        token = session.access_token;
                    }
                }
            }
        } catch (e) {
            console.warn("Failed to read token synchronously:", e);
        }

        // Fallback to the slow, lock-acquiring async getSession only if we don't have a valid cached token
        if (!token) {
            const { data } = await supabase.auth.getSession();
            token = data?.session?.access_token;
        }

        if (token) {
            config.headers = config.headers ?? {};
            config.headers["Authorization"] = `Bearer ${token}`;
        }
    }
    return config;
});

// Handle 401 errors
API.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response && error.response.status === 401) {
            console.error("401 Unauthorized - parser API request rejected. Supabase session may be missing or expired.");
        }
        return Promise.reject(error);
    }
);

export default API;
