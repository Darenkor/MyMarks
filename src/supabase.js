/* ============================================
   supabase.js — Supabase Client & Auth Module
   ============================================ */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://wymyqcasgvazakgtbyyh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5bXlxY2FzZ3ZhemFrZ3RieXloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MzMyNjAsImV4cCI6MjA4ODIwOTI2MH0.e0F9MVkN55wUNXxTTIWGwxzyG2MacjS8V4Aq7NFlj6o';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// -------- Auth --------

export async function getUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

export async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.user;
}

export async function signUp(email, password) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return data.user;
}

export async function updateUserAuth(updates) {
    // updates can have { email, password }
    const { data, error } = await supabase.auth.updateUser(updates);
    if (error) throw error;
    return data.user;
}

export async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
}

export function onAuthChange(callback) {
    return supabase.auth.onAuthStateChange((event, session) => {
        callback(event, session?.user || null);
    });
}

// -------- Cloud Sync --------

export async function cloudSave(boards, categories, bookmarks) {
    const user = await getUser();
    if (!user) return null;

    const data = { boards, categories, bookmarks, savedAt: Date.now() };

    const { error } = await supabase
        .from('user_data')
        .upsert({
            user_id: user.id,
            data,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

    if (error) throw error;
    return data;
}

export async function cloudLoad() {
    const user = await getUser();
    if (!user) return null;

    const { data, error } = await supabase
        .from('user_data')
        .select('data, updated_at')
        .eq('user_id', user.id)
        .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows found
    return data?.data || null;
}
