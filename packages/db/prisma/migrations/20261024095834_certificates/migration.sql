-- AlterTable
ALTER TABLE "Certificate" ADD COLUMN     "data" JSONB NOT NULL,
ADD COLUMN     "revokeReason" TEXT,
ADD COLUMN     "revokedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CertificateTemplate" ADD COLUMN     "backgroundMime" TEXT NOT NULL;

