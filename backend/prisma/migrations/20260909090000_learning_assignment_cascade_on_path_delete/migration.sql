-- Deleting a course was blocked by ON DELETE RESTRICT on its assignments, so any
-- course that had ever been assigned (including role/department auto-assignment)
-- failed with a foreign-key error. Assignments + their progress are derived from
-- the course, so they cascade with it (item_progress / path_progress already
-- cascade off the assignment).
ALTER TABLE "learning_path_assignments" DROP CONSTRAINT "learning_path_assignments_path_id_fkey";
ALTER TABLE "learning_path_assignments" ADD CONSTRAINT "learning_path_assignments_path_id_fkey" FOREIGN KEY ("path_id") REFERENCES "learning_paths"("id") ON DELETE CASCADE ON UPDATE CASCADE;
