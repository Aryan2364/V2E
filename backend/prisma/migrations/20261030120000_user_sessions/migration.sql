-- Per-device sign-in sessions. Replaces the single refresh-token hash on "users"
-- (which every login/rotation overwrote, logging out the user's other devices).
-- Purely additive: the old users.refresh_token* columns are KEPT so refresh tokens
-- issued before this deploy (no `sid` claim) still work and are silently migrated.
-- Those legacy columns can be dropped once all pre-sessions tokens have expired
-- (30 days after deploy).

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "prev_token_hash" TEXT,
    "current_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");

-- CreateIndex
CREATE INDEX "user_sessions_token_hash_idx" ON "user_sessions"("token_hash");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
