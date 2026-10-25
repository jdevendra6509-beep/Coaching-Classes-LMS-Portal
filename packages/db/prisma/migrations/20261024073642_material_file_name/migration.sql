-- AlterTable
ALTER TABLE "Material" ADD COLUMN     "fileName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Material_storageKey_key" ON "Material"("storageKey");

