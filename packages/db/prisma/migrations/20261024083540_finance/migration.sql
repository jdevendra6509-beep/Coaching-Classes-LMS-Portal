-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BillPayment" ADD COLUMN     "accountId" UUID NOT NULL,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "reversalOfId" UUID;

-- AlterTable
ALTER TABLE "StudentInvoice" ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StudentPayment" ADD COLUMN     "accountId" UUID NOT NULL,
ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "InvoiceInstallment" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "InvoiceInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceInstallment_invoiceId_idx" ON "InvoiceInstallment"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_instituteId_vendorId_billNumber_key" ON "Bill"("instituteId", "vendorId", "billNumber");

-- CreateIndex
CREATE INDEX "StudentPayment_instituteId_invoiceId_idx" ON "StudentPayment"("instituteId", "invoiceId");

-- AddForeignKey
ALTER TABLE "InvoiceInstallment" ADD CONSTRAINT "InvoiceInstallment_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceInstallment" ADD CONSTRAINT "InvoiceInstallment_instituteId_invoiceId_fkey" FOREIGN KEY ("instituteId", "invoiceId") REFERENCES "StudentInvoice"("instituteId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentPayment" ADD CONSTRAINT "StudentPayment_instituteId_accountId_fkey" FOREIGN KEY ("instituteId", "accountId") REFERENCES "Account"("instituteId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillPayment" ADD CONSTRAINT "BillPayment_instituteId_accountId_fkey" FOREIGN KEY ("instituteId", "accountId") REFERENCES "Account"("instituteId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

