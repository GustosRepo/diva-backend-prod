import supabase from './supabaseClient.js';

(async () => {
  try {
    console.log('🔎 Testing Supabase connection to', process.env.SUPABASE_URL);
    const { data, error } = await supabase.from('order').select('*').limit(1);
    console.log('✅ Query result data:', data);
    console.log('ℹ️ Query error:', error);
  } catch (err) {
    console.error('❌ Exception:', err);
  }
  process.exit(0);
})();
