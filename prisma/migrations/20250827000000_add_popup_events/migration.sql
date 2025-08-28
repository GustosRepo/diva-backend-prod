-- Create popup_events table
CREATE TABLE popup_events (
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
('Casino Resort Partnerships', 'Monthly', '💎');
