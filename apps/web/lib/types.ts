export interface PersonUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  lastLoginAt: string | null;
}

export interface Student {
  id: string;
  admissionNo: string;
  dateOfBirth: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  guardianEmail: string | null;
  address: string | null;
  createdAt: string;
  membership: { id: string; isActive: boolean; user: PersonUser };
  enrollments: { id: string; status: string; enrolledAt: string; completedAt: string | null; course: { id: string; code: string; name: string }; batch: { id: string; name: string } }[];
}

export interface Teacher {
  id: string;
  employeeCode: string | null;
  qualification: string | null;
  joiningDate: string | null;
  membership: { id: string; isActive: boolean; user: PersonUser };
  _count: { batches: number };
}

export interface Course {
  id: string;
  code: string;
  name: string;
  description: string | null;
  durationWeeks: number | null;
  fee: string;
  status: string;
  _count: { batches: number; enrollments: number };
}

export interface Batch {
  id: string;
  name: string;
  startDate: string;
  endDate: string | null;
  schedule: string | null;
  capacity: number | null;
  course: { id: string; code: string; name: string; status: string };
  teachers: { teacher: { id: string; membership: { user: { name: string; email: string } } } }[];
  _count: { enrollments: number };
}

export interface Invoice {
  id: string;
  number: string;
  status: string;
  issueDate: string;
  dueDate: string | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  outstanding: string;
  overdue: string;
  notes: string | null;
  voidReason: string | null;
  student: { id: string; admissionNo: string; membership: { user: { name: string; email: string; phone: string | null } } };
  enrollment: { id: string; course: { id: string; code: string; name: string }; batch: { id: string; name: string } } | null;
  lines: { description: string; quantity: number; unitPrice: string; taxRate: string; amount: string }[];
  discounts: { description: string; amount: string }[];
  installments: { dueDate: string; amount: string }[];
  payments: { id: string; receiptNo: string; amount: string; method: string; reference: string | null; receivedAt: string; reversedAt: string | null; reversalReason: string | null }[];
}

export interface FeeSummary {
  billed: string;
  paid: string;
  outstanding: string;
  overdue: string;
  invoices: Invoice[];
}

export interface Material {
  id: string;
  title: string;
  description: string | null;
  type: string;
  moduleId: string | null;
  position: number;
  isPublished: boolean;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  externalUrl?: string | null;
  createdAt: string;
  uploadedBy: string;
}

export interface Outline {
  modules: { id: string; title: string; position: number; materials: Material[] }[];
  ungrouped: Material[];
}

export interface AttendanceSummary {
  batchId: string;
  batchName: string;
  courseName: string;
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  percentage: number | null;
}

export interface Certificate {
  id: string;
  serialNo: string;
  verificationCode: string;
  data: { studentName: string; courseName: string; completionDate: string; verificationUrl: string };
  issuedAt: string;
  emailedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  enrollmentId: string;
  enrollment: { studentId: string; course: { id: string; name: string } };
}

export interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  isSystem: boolean;
  isActive: boolean;
}
