-- TPL Scraper Database Initialization Script
-- Run this script to set up the PostgreSQL database for the TPL Scraper

-- Create database (run this as a superuser)
-- CREATE DATABASE tpl_scraper;

-- Connect to the database and create the table
-- \c tpl_scraper;

-- Create the main table for RSS items
CREATE TABLE IF NOT EXISTS RSS_ITEMS (
  ID SERIAL PRIMARY KEY,
  TITLE VARCHAR(500) NOT NULL UNIQUE,
  LINK VARCHAR(1000) NOT NULL,
  DESCRIPTION TEXT,
  CONTENT_ENCODED TEXT,
  RECORD_DATA JSONB,
  FIRST_SEEN TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  LAST_SEEN TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  IS_ACTIVE BOOLEAN DEFAULT TRUE,
  CREATED_AT TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UPDATED_AT TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS IDX_RSS_ITEMS_TITLE ON RSS_ITEMS(TITLE);

CREATE INDEX IF NOT EXISTS IDX_RSS_ITEMS_ACTIVE ON RSS_ITEMS(IS_ACTIVE);

CREATE INDEX IF NOT EXISTS IDX_RSS_ITEMS_LAST_SEEN ON RSS_ITEMS(LAST_SEEN);

-- Create a user for the application (optional, adjust credentials as needed)
-- CREATE USER tpl_scraper_user WITH PASSWORD 'your_secure_password';
-- GRANT ALL PRIVILEGES ON DATABASE tpl_scraper TO tpl_scraper_user;
-- GRANT ALL PRIVILEGES ON TABLE rss_items TO tpl_scraper_user;
-- GRANT USAGE, SELECT ON SEQUENCE rss_items_id_seq TO tpl_scraper_user;

COMMENT ON TABLE RSS_ITEMS IS 'Stores RSS feed items from Toronto Public Library';
COMMENT ON COLUMN RSS_ITEMS.TITLE IS 'Event title (unique identifier)';
COMMENT ON COLUMN RSS_ITEMS.LINK IS 'Direct link to the event page';
COMMENT ON COLUMN RSS_ITEMS.DESCRIPTION IS 'Event description';
COMMENT ON COLUMN RSS_ITEMS.CONTENT_ENCODED IS 'Full HTML content of the event';
COMMENT ON COLUMN RSS_ITEMS.RECORD_DATA IS 'Additional metadata from RSS feed';
COMMENT ON COLUMN RSS_ITEMS.FIRST_SEEN IS 'When this item was first detected';
COMMENT ON COLUMN RSS_ITEMS.LAST_SEEN IS 'When this item was last seen in the feed';
COMMENT ON COLUMN RSS_ITEMS.IS_ACTIVE IS 'Whether this item is currently in the RSS feed';