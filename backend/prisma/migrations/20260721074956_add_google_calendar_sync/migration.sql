-- AlterTable
ALTER TABLE "meetings" ADD COLUMN     "google_event_id" TEXT,
ADD COLUMN     "google_ical_uid" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "google_refresh_token" TEXT;
