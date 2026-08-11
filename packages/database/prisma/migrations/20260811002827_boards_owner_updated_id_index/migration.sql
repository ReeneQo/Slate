-- DropIndex
DROP INDEX "boards_owner_id_idx";

-- CreateIndex
CREATE INDEX "boards_owner_id_updated_at_id_idx" ON "boards"("owner_id", "updated_at" DESC, "id");
