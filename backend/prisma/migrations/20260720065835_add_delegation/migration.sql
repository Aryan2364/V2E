-- CreateEnum
CREATE TYPE "DelegationStatus" AS ENUM ('active', 'completed', 'cancelled');

-- CreateTable
CREATE TABLE "delegations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "kra" TEXT,
    "running_by" TIMESTAMP(3),
    "first_check_in" TIMESTAMP(3),
    "status" "DelegationStatus" NOT NULL DEFAULT 'active',
    "review_task_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delegations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delegation_criteria" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "delegation_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "target" TEXT,
    "is_met" BOOLEAN NOT NULL DEFAULT false,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delegation_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delegations_organization_id_idx" ON "delegations"("organization_id");

-- CreateIndex
CREATE INDEX "delegations_owner_user_id_idx" ON "delegations"("owner_user_id");

-- CreateIndex
CREATE INDEX "delegations_created_by_user_id_idx" ON "delegations"("created_by_user_id");

-- CreateIndex
CREATE INDEX "delegation_criteria_delegation_id_idx" ON "delegation_criteria"("delegation_id");

-- CreateIndex
CREATE INDEX "delegation_criteria_organization_id_idx" ON "delegation_criteria"("organization_id");

-- AddForeignKey
ALTER TABLE "delegation_criteria" ADD CONSTRAINT "delegation_criteria_delegation_id_fkey" FOREIGN KEY ("delegation_id") REFERENCES "delegations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
