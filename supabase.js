// Replace these with your actual Supabase project values
// Settings → API in your Supabase dashboard
const SUPABASE_URL = "https://zovlwzzpuddljdbqmdgm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpvdmx3enpwdWRkbGpkYnFtZGdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MDc0MjUsImV4cCI6MjA5MDM4MzQyNX0.j1Zo0nRXBvwHJ5ObXcHu_LBIVLREtaSo0r-3FlyXYHI";

// Using the Supabase CDN client (no build step needed)
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
