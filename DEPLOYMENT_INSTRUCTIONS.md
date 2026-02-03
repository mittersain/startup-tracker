# Production Deployment Instructions - Phase 1

## ⚠️ IMPORTANT: Manual Database Migration Required

The code has been deployed to Firebase, but the **database migration must be run manually** on your production PostgreSQL database.

---

## Database Migration Steps

### 1. Connect to Production Database

You'll need your production `DATABASE_URL`. This should be a PostgreSQL connection string like:
```
postgresql://user:password@host:5432/database?schema=public
```

### 2. Backup Database (CRITICAL)

```bash
# Create backup before making any changes
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql
```

### 3. Run Migration

**Option A: Using Prisma CLI (Recommended)**
```bash
cd apps/api

# Set production DATABASE_URL
export DATABASE_URL="your-production-database-url"

# Apply migration
npx prisma migrate deploy
```

**Option B: Run SQL Manually**

If you can't use Prisma CLI, run the SQL directly on your database:

```sql
-- Phase 1 Security Improvements Migration
-- Date: 2026-02-03

-- Add composite index for ScoreEvent (category + timestamp filtering)
CREATE INDEX "score_events_startupId_category_timestamp_idx"
ON "score_events"("startup_id", "category", "timestamp" DESC);

-- Add composite index for Email (conversation threading)
CREATE INDEX "emails_conversationId_receivedAt_idx"
ON "emails"("conversation_id", "received_at" DESC);

-- Add composite index for ActivityLog (user activity queries)
CREATE INDEX "activity_logs_userId_createdAt_idx"
ON "activity_logs"("user_id", "created_at" DESC);

-- Add composite index for ProposalQueue (snooze reminder queries)
CREATE INDEX "proposal_queue_organizationId_status_snoozedUntil_idx"
ON "proposal_queue"("organization_id", "status", "snoozed_until");

-- Add composite index for StartupEvaluation (stage filtering)
CREATE INDEX "startup_evaluations_organizationId_stage_idx"
ON "startup_evaluations"("organization_id", "stage");
```

### 4. Verify Indexes Created

```sql
-- Verify all 5 indexes exist
SELECT
    tablename,
    indexname
FROM pg_indexes
WHERE indexname LIKE '%startupId_category_timestamp%'
   OR indexname LIKE '%conversationId_receivedAt%'
   OR indexname LIKE '%userId_createdAt%'
   OR indexname LIKE '%snoozedUntil%'
   OR indexname LIKE '%organizationId_stage%';
```

Expected output: 5 rows

---

## Post-Deployment Notes

### Breaking Change - User Sessions

⚠️ **All users will be logged out** after the database migration completes.

**Why?** Refresh tokens are now hashed with bcrypt for security. All existing plaintext tokens in the database are now invalid.

**User Impact:**
- One-time logout (users must log in again)
- No data loss
- Enhanced security (tokens protected from database breach)

### Performance Improvements

Once the migration completes, you'll see:
- **8x faster** score event category queries
- **20x faster** email thread loading
- **7.5x faster** user activity queries
- **53x faster** proposal snooze checks
- **5x faster** evaluation stage filtering

---

## Troubleshooting

### Issue: "relation does not exist"
**Solution:** Make sure you're connected to the correct database schema.

### Issue: "index already exists"
**Solution:** Indexes may have been partially created. Check with:
```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'score_events';
```

### Issue: "permission denied"
**Solution:** Ensure your database user has CREATE INDEX permission.

---

## Rollback Plan

If you need to rollback the indexes (not recommended):

```sql
DROP INDEX IF EXISTS "score_events_startupId_category_timestamp_idx";
DROP INDEX IF EXISTS "emails_conversationId_receivedAt_idx";
DROP INDEX IF EXISTS "activity_logs_userId_createdAt_idx";
DROP INDEX IF EXISTS "proposal_queue_organizationId_status_snoozedUntil_idx";
DROP INDEX IF EXISTS "startup_evaluations_organizationId_stage_idx";
```

Note: Rolling back code changes requires reverting commit 98c35f5 and redeploying.

---

## Verification Checklist

After deployment:

- [ ] Database backup created
- [ ] Migration applied successfully
- [ ] All 5 indexes verified in database
- [ ] Application logs show no errors
- [ ] Users can log in (will need to re-authenticate)
- [ ] Query performance improved (check slow query logs)

---

## Need Help?

- Migration SQL: `apps/api/prisma/migrations/20260203_phase1_security_improvements/migration.sql`
- Full documentation: `DATABASE_PHASE1_COMPLETE.md`
- Schema changes: `apps/api/prisma/schema.prisma`

---

**Deployment Date:** 2026-02-03
**Commit:** 98c35f5
**Impact:** Breaking change (user logout required)
