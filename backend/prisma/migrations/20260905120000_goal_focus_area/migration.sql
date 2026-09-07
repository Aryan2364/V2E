-- CreateEnum
CREATE TYPE "GoalFocusArea" AS ENUM ('customer', 'finance', 'learning_growth', 'internal_process');

-- AlterTable
ALTER TABLE "goals" ADD COLUMN     "focus_area" "GoalFocusArea";
