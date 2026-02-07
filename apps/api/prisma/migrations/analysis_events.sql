-- Migration: Create analysis_events table
-- Run this manually in your database console if Prisma migrations are not working
--
-- This creates the table for tracking analysis timeline events
-- Each startup can have multiple analysis events from emails, pitch decks, etc.
--

-- Create the analysis_events table
CREATE TABLE IF NOT EXISTS analysis_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    source_type VARCHAR(50) NOT NULL, -- 'email', 'deck', 'manual', 'initial'
    source_id UUID,                   -- ID of the email or deck that triggered this
    source_name TEXT,                  -- Filename or email subject

    -- What was analyzed
    input_summary TEXT,                -- Brief summary of the input

    -- Analysis results
    new_insights JSONB,                -- New things learned
    updated_insights JSONB,            -- Things that changed from previous
    confirmed_insights JSONB,          -- Things that were confirmed
    concerns JSONB,                    -- New or updated concerns
    questions JSONB,                   -- Questions for the founder

    -- Cumulative state after this analysis
    cumulative_analysis JSONB,         -- Full analysis state at this point

    -- Confidence tracking
    overall_confidence FLOAT,          -- 0-1 confidence in our understanding

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_analysis_events_startup_id ON analysis_events(startup_id);
CREATE INDEX IF NOT EXISTS idx_analysis_events_created_at ON analysis_events(created_at);

-- Add the consolidated_deck_analysis column to startups if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'startups'
        AND column_name = 'consolidated_deck_analysis'
    ) THEN
        ALTER TABLE startups ADD COLUMN consolidated_deck_analysis JSONB;
    END IF;
END $$;

-- Success message
-- Run: SELECT COUNT(*) FROM analysis_events; to verify the table was created
