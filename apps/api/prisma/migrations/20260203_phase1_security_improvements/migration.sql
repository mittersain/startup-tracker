-- Phase 1 Security Improvements Migration
-- Date: 2026-02-03
-- Description: Add composite indexes for performance optimization

-- Add composite index for ScoreEvent (category + timestamp filtering)
CREATE INDEX "score_events_startupId_category_timestamp_idx" ON "score_events"("startup_id", "category", "timestamp" DESC);

-- Add composite index for Email (conversation threading)
CREATE INDEX "emails_conversationId_receivedAt_idx" ON "emails"("conversation_id", "received_at" DESC);

-- Add composite index for ActivityLog (user activity queries)
CREATE INDEX "activity_logs_userId_createdAt_idx" ON "activity_logs"("user_id", "created_at" DESC);

-- Add composite index for ProposalQueue (snooze reminder queries)
CREATE INDEX "proposal_queue_organizationId_status_snoozedUntil_idx" ON "proposal_queue"("organization_id", "status", "snoozed_until");

-- Add composite index for StartupEvaluation (stage filtering)
CREATE INDEX "startup_evaluations_organizationId_stage_idx" ON "startup_evaluations"("organization_id", "stage");

-- IMPORTANT NOTE: Refresh tokens are now hashed with bcrypt before storage
-- This is a breaking change that requires:
-- 1. All existing refresh tokens will be invalidated
-- 2. Users will need to log in again after deployment
-- 3. No data migration needed - old tokens will simply fail validation
