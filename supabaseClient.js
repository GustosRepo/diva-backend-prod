import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Ensure we load the backend/.env no matter the current working directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Use the service role key for backend
);

if (process.env.NODE_ENV !== 'production') {
  const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const masked = rawKey ? `${rawKey.slice(0, 4)}...${rawKey.slice(-4)}` : '(not set)';
  console.log(`🔐 Supabase service role key (masked): ${masked}`);
}

export default supabase;