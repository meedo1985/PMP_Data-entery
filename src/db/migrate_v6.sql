-- Migration v6: Add live_type, crew_type, use_special, special_price to orders
-- Supports new tiered pricing for Live and Crew categories
ALTER TABLE orders ADD COLUMN live_type TEXT;
ALTER TABLE orders ADD COLUMN crew_type TEXT;
ALTER TABLE orders ADD COLUMN use_special INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN special_price REAL;

-- Also add permissions column to users for granular access control
ALTER TABLE users ADD COLUMN permissions TEXT;
