import supabase from './supabaseClient.js';

async function createPopupEventsTable() {
  try {
    console.log('🔧 Creating popup_events table...');
    
    // You'll need to run this SQL directly in your Supabase SQL editor:
    const createTableSQL = `
CREATE TABLE IF NOT EXISTS popup_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    emoji VARCHAR(10) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert seed data
INSERT INTO popup_events (title, description, emoji) VALUES
('Las Vegas Market', 'First Sunday monthly', '🎰'),
('Vegas Strip Events', 'Seasonal shows', '🎭'),
('Vegas Beauty Expo', 'Coming this fall', '✨'),
('Casino Resort Partnerships', 'Monthly', '💎')
ON CONFLICT DO NOTHING;
    `;
    
    console.log('📋 Please run this SQL in your Supabase SQL editor:');
    console.log('='.repeat(50));
    console.log(createTableSQL);
    console.log('='.repeat(50));
    
    // Test if table exists by attempting to fetch
    const { data, error } = await supabase
      .from('popup_events')
      .select('*')
      .limit(1);
    
    if (!error) {
      console.log('✅ Table already exists and is accessible!');
      const { data: allEvents } = await supabase.from('popup_events').select('*');
      console.log(`✅ Current events in database: ${allEvents?.length || 0}`);
    } else {
      console.log('❌ Table not found. Please create it using the SQL above.');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

createPopupEventsTable();
