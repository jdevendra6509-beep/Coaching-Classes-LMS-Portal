-- CreateEnum
CREATE TYPE "InstituteStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('CREATED', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('INSTITUTE_ADMIN', 'ACCOUNTANT', 'TEACHER', 'STUDENT');

-- CreateEnum
CREATE TYPE "AuthTokenType" AS ENUM ('INVITE', 'PASSWORD_RESET', 'EMAIL_VERIFY');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'DROPPED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- CreateEnum
CREATE TYPE "MaterialType" AS ENUM ('PDF', 'DOCUMENT', 'PRESENTATION', 'IMAGE', 'VIDEO', 'LINK');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FLAT');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'ONLINE');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateTable
CREATE TABLE "Institute" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "gstin" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "logoKey" TEXT,
    "status" "InstituteStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Institute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pricePerMonth" DECIMAL(14,2) NOT NULL,
    "maxStudents" INTEGER NOT NULL,
    "maxStorageMb" INTEGER NOT NULL,
    "razorpayPlanId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'CREATED',
    "razorpaySubscriptionId" TEXT,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformPayment" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "subscriptionId" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "gstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "invoiceNumber" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "instituteId" UUID,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "AuthTokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Teacher" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "employeeCode" TEXT,
    "qualification" TEXT,
    "joiningDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Teacher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "admissionNo" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "guardianName" TEXT,
    "guardianPhone" TEXT,
    "guardianEmail" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationWeeks" INTEGER,
    "fee" DECIMAL(14,2) NOT NULL,
    "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
    "certificateTemplateId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "schedule" TEXT,
    "capacity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchTeacher" (
    "instituteId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,

    CONSTRAINT "BatchTeacher_pkey" PRIMARY KEY ("batchId","teacherId")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "completedById" UUID,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceSession" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "takenById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "instituteId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "remark" TEXT,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("sessionId","studentId")
);

-- CreateTable
CREATE TABLE "CourseModule" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "CourseModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "moduleId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "MaterialType" NOT NULL,
    "storageKey" TEXT,
    "externalUrl" TEXT,
    "mimeType" TEXT,
    "sizeBytes" BIGINT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discount" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DiscountType" NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "courseId" UUID,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Discount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentInvoice" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "studentId" UUID NOT NULL,
    "enrollmentId" UUID,
    "issueDate" DATE NOT NULL,
    "dueDate" DATE,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceDiscount" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "discountId" UUID,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentPayment" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "invoiceId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "recordedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "billNumber" TEXT NOT NULL,
    "billDate" DATE NOT NULL,
    "dueDate" DATE,
    "expenseAccountId" UUID NOT NULL,
    "description" TEXT,
    "total" DECIMAL(14,2) NOT NULL,
    "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "attachmentKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillPayment" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "billId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "parentId" UUID,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "memo" TEXT,
    "sourceType" TEXT,
    "sourceId" UUID,
    "postedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "instituteId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("instituteId","type")
);

-- CreateTable
CREATE TABLE "CertificateTemplate" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "backgroundKey" TEXT NOT NULL,
    "pageWidth" DOUBLE PRECISION NOT NULL,
    "pageHeight" DOUBLE PRECISION NOT NULL,
    "fields" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertificateTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" UUID NOT NULL,
    "instituteId" UUID NOT NULL,
    "enrollmentId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "serialNo" TEXT NOT NULL,
    "verificationCode" TEXT NOT NULL,
    "pdfKey" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailedAt" TIMESTAMP(3),

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "instituteId" UUID,
    "actorUserId" UUID,
    "membershipId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Institute_slug_key" ON "Institute"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_razorpayPlanId_key" ON "Plan"("razorpayPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_razorpaySubscriptionId_key" ON "Subscription"("razorpaySubscriptionId");

-- CreateIndex
CREATE INDEX "Subscription_instituteId_idx" ON "Subscription"("instituteId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPayment_razorpayOrderId_key" ON "PlatformPayment"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPayment_razorpayPaymentId_key" ON "PlatformPayment"("razorpayPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPayment_invoiceNumber_key" ON "PlatformPayment"("invoiceNumber");

-- CreateIndex
CREATE INDEX "PlatformPayment_instituteId_idx" ON "PlatformPayment"("instituteId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_eventId_key" ON "WebhookEvent"("provider", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_instituteId_id_key" ON "Membership"("instituteId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_instituteId_userId_role_key" ON "Membership"("instituteId", "userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_instituteId_id_key" ON "Teacher"("instituteId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_instituteId_membershipId_key" ON "Teacher"("instituteId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_instituteId_employeeCode_key" ON "Teacher"("instituteId", "employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "Student_instituteId_id_key" ON "Student"("instituteId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Student_instituteId_membershipId_key" ON "Student"("instituteId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_instituteId_admissionNo_key" ON "Student"("instituteId", "admissionNo");

-- CreateIndex
CREATE UNIQUE INDEX "Course_instituteId_id_key" ON "Course"("instituteId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Course_instituteId_code_key" ON "Course"("instituteId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_instituteId_id_key" ON "Batch"("instituteId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_instituteId_courseId_id_key" ON "Batch"("instituteId", "courseId", "id");

-- CreateIndex
CREATE INDEX "Enrollment_instituteId_courseId_idx" ON "Enrollment"("instituteId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_instituteId_id_key" ON "Enrollment"("instituteId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_studentId_batchId_key" ON "Enrollment"("studentId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSession_instituteId_id_key" ON "AttendanceSession"("instituteId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSession_batchId_date_key" ON "AttendanceSession"("batchId", "date");

-- CreateIndex
CREATE INDEX "AttendanceRecord_instituteId_studentId_idx" ON "AttendanceRecord"("instituteId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseModule_instituteId_id_key" ON "CourseModule"("instituteId", "id");

-- CreateIndex
CREATE INDEX "Material_instituteId_courseId_idx" ON "Material"("instituteId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "Material_instituteId_id_key" ON "Material"("instituteId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Discount_instituteId_id_key" ON "Discount"("instituteId", "id");

-- CreateIndex
CREATE INDEX "StudentInvoice_instituteId_studentId_idx" ON "StudentInvoice"("instituteId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentInvoice_instituteId_id_key" ON "StudentInvoice"("instituteId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StudentInvoice_instituteId_number_key" ON "StudentInvoice"("instituteId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "StudentPayment_instituteId_receiptNo_key" ON "StudentPayment"("instituteId", "receiptNo");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_instituteId_id_key" ON "Vendor"("instituteId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_instituteId_id_key" ON "Bill"("instituteId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Account_instituteId_id_key" ON "Account"("instituteId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Account_instituteId_code_key" ON "Account"("instituteId", "code");

-- CreateIndex
CREATE INDEX "JournalEntry_instituteId_date_idx" ON "JournalEntry"("instituteId", "date");

-- CreateIndex
CREATE INDEX "JournalEntry_sourceType_sourceId_idx" ON "JournalEntry"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_instituteId_id_key" ON "JournalEntry"("instituteId", "id");

-- CreateIndex
CREATE INDEX "JournalLine_instituteId_accountId_idx" ON "JournalLine"("instituteId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "CertificateTemplate_instituteId_id_key" ON "CertificateTemplate"("instituteId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_verificationCode_key" ON "Certificate"("verificationCode");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_instituteId_enrollmentId_key" ON "Certificate"("instituteId", "enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_instituteId_serialNo_key" ON "Certificate"("instituteId", "serialNo");

-- CreateIndex
CREATE INDEX "AuditLog_instituteId_createdAt_idx" ON "AuditLog"("instituteId", "createdAt");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformPayment" ADD CONSTRAINT "PlatformPayment_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformPayment" ADD CONSTRAINT "PlatformPayment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_instituteId_membershipId_fkey" FOREIGN KEY ("instituteId", "membershipId") REFERENCES "Membership"("instituteId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_instituteId_membershipId_fkey" FOREIGN KEY ("instituteId", "membershipId") REFERENCES "Membership"("instituteId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_certificateTemplateId_fkey" FOREIGN KEY ("certificateTemplateId") REFERENCES "CertificateTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_instituteId_courseId_fkey" FOREIGN KEY ("instituteId", "courseId") REFERENCES "Course"("instituteId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchTeacher" ADD CONSTRAINT "BatchTeacher_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchTeacher" ADD CONSTRAINT "BatchTeacher_instituteId_batchId_fkey" FOREIGN KEY ("instituteId", "batchId") REFERENCES "Batch"("instituteId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchTeacher" ADD CONSTRAINT "BatchTeacher_instituteId_teacherId_fkey" FOREIGN KEY ("instituteId", "teacherId") REFERENCES "Teacher"("instituteId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_instituteId_studentId_fkey" FOREIGN KEY ("instituteId", "studentId") REFERENCES "Student"("instituteId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_instituteId_courseId_fkey" FOREIGN KEY ("instituteId", "courseId") REFERENCES "Course"("instituteId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_instituteId_courseId_batchId_fkey" FOREIGN KEY ("instituteId", "courseId", "batchId") REFERENCES "Batch"("instituteId", "courseId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_instituteId_batchId_fkey" FOREIGN KEY ("instituteId", "batchId") REFERENCES "Batch"("instituteId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_instituteId_takenById_fkey" FOREIGN KEY ("instituteId", "takenById") REFERENCES "Membership"("instituteId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_instituteId_sessionId_fkey" FOREIGN KEY ("instituteId", "sessionId") REFERENCES "AttendanceSession"("instituteId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_instituteId_studentId_fkey" FOREIGN KEY ("instituteId", "studentId") REFERENCES "Student"("instituteId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseModule" ADD CONSTRAINT "CourseModule_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseModule" ADD CONSTRAINT "CourseModule_instituteId_courseId_fkey" FOREIGN KEY ("instituteId", "courseId") REFERENCES "Course"("instituteId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_instituteId_courseId_fkey" FOREIGN KEY ("instituteId", "courseId") REFERENCES "Course"("instituteId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "CourseModule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_instituteId_uploadedById_fkey" FOREIGN KEY ("instituteId", "uploadedById") REFERENCES "Membership"("instituteId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discount" ADD CONSTRAINT "Discount_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discount" ADD CONSTRAINT "Discount_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentInvoice" ADD CONSTRAINT "StudentInvoice_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentInvoice" ADD CONSTRAINT "StudentInvoice_instituteId_studentId_fkey" FOREIGN KEY ("instituteId", "studentId") REFERENCES "Student"("instituteId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentInvoice" ADD CONSTRAINT "StudentInvoice_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_instituteId_invoiceId_fkey" FOREIGN KEY ("instituteId", "invoiceId") REFERENCES "StudentInvoice"("instituteId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceDiscount" ADD CONSTRAINT "InvoiceDiscount_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceDiscount" ADD CONSTRAINT "InvoiceDiscount_instituteId_invoiceId_fkey" FOREIGN KEY ("instituteId", "invoiceId") REFERENCES "StudentInvoice"("instituteId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceDiscount" ADD CONSTRAINT "InvoiceDiscount_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "Discount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentPayment" ADD CONSTRAINT "StudentPayment_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentPayment" ADD CONSTRAINT "StudentPayment_instituteId_invoiceId_fkey" FOREIGN KEY ("instituteId", "invoiceId") REFERENCES "StudentInvoice"("instituteId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentPayment" ADD CONSTRAINT "StudentPayment_instituteId_studentId_fkey" FOREIGN KEY ("instituteId", "studentId") REFERENCES "Student"("instituteId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentPayment" ADD CONSTRAINT "StudentPayment_instituteId_recordedById_fkey" FOREIGN KEY ("instituteId", "recordedById") REFERENCES "Membership"("instituteId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_instituteId_vendorId_fkey" FOREIGN KEY ("instituteId", "vendorId") REFERENCES "Vendor"("instituteId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_instituteId_expenseAccountId_fkey" FOREIGN KEY ("instituteId", "expenseAccountId") REFERENCES "Account"("instituteId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillPayment" ADD CONSTRAINT "BillPayment_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillPayment" ADD CONSTRAINT "BillPayment_instituteId_billId_fkey" FOREIGN KEY ("instituteId", "billId") REFERENCES "Bill"("instituteId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_instituteId_postedById_fkey" FOREIGN KEY ("instituteId", "postedById") REFERENCES "Membership"("instituteId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_instituteId_entryId_fkey" FOREIGN KEY ("instituteId", "entryId") REFERENCES "JournalEntry"("instituteId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_instituteId_accountId_fkey" FOREIGN KEY ("instituteId", "accountId") REFERENCES "Account"("instituteId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSequence" ADD CONSTRAINT "DocumentSequence_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateTemplate" ADD CONSTRAINT "CertificateTemplate_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_instituteId_enrollmentId_fkey" FOREIGN KEY ("instituteId", "enrollmentId") REFERENCES "Enrollment"("instituteId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_instituteId_templateId_fkey" FOREIGN KEY ("instituteId", "templateId") REFERENCES "CertificateTemplate"("instituteId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
