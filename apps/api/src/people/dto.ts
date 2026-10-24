import { Transform } from "class-transformer";
import {
  IsBoolean, IsDateString, IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength,
} from "class-validator";
import { Role } from "@lms/db";
import { PageQuery } from "../common/pagination.js";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);
const lowerTrim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim().toLowerCase() : value);
/** CSV cells and optional form fields arrive as "" when blank; treat that as "not provided". */
const blankToUndefined = ({ value }: { value: unknown }) => (value === "" ? undefined : typeof value === "string" ? value.trim() : value);

export const PHONE = /^\+?[0-9]{10,13}$/;

export class PersonDto {
  @Transform(trim) @IsString() @Length(2, 120)
  name: string;

  @Transform(lowerTrim) @IsEmail()
  email: string;

  @IsOptional() @Transform(blankToUndefined) @Matches(PHONE, { message: "phone must be 10-13 digits" })
  phone?: string;
}

export class CreateTeacherDto extends PersonDto {
  @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(40)
  employeeCode?: string;

  @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(200)
  qualification?: string;

  @IsOptional() @Transform(blankToUndefined) @IsDateString({ strict: true })
  joiningDate?: string;
}

export class UpdateTeacherDto {
  /** Only while the teacher hasn't activated their account; afterwards the name belongs to them. */
  @IsOptional() @Transform(trim) @IsString() @Length(2, 120)
  name?: string;

  @IsOptional() @Transform(blankToUndefined) @Matches(PHONE)
  phone?: string;

  @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(40)
  employeeCode?: string;

  @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(200)
  qualification?: string;

  @IsOptional() @Transform(blankToUndefined) @IsDateString({ strict: true })
  joiningDate?: string;
}

export class StudentFields {
  /** Generated (ADM-00001, …) when left empty. */
  @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(40)
  admissionNo?: string;

  @IsOptional() @Transform(blankToUndefined) @IsDateString({ strict: true })
  dateOfBirth?: string;

  @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(120)
  guardianName?: string;

  @IsOptional() @Transform(blankToUndefined) @Matches(PHONE, { message: "guardianPhone must be 10-13 digits" })
  guardianPhone?: string;

  @IsOptional() @Transform(({ value }) => (value === "" ? undefined : typeof value === "string" ? value.trim().toLowerCase() : value)) @IsEmail()
  guardianEmail?: string;

  @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(500)
  address?: string;
}

export class CreateStudentDto extends StudentFields {
  @Transform(trim) @IsString() @Length(2, 120)
  name: string;

  @Transform(lowerTrim) @IsEmail()
  email: string;

  @IsOptional() @Transform(blankToUndefined) @Matches(PHONE, { message: "phone must be 10-13 digits" })
  phone?: string;

  /** Optionally enroll straight into a batch. */
  @IsOptional() @IsUUID()
  batchId?: string;
}

export class UpdateStudentDto extends StudentFields {
  @IsOptional() @Transform(trim) @IsString() @Length(2, 120)
  name?: string;

  @IsOptional() @Transform(blankToUndefined) @Matches(PHONE)
  phone?: string;
}

export class ImportStudentsDto {
  /**
   * CSV text with a header row. Columns: name, email (required), phone, admissionNo,
   * dateOfBirth (YYYY-MM-DD), guardianName, guardianPhone, guardianEmail, address,
   * batch (batch name, optional — enrolls the student).
   */
  @IsString() @MaxLength(2_000_000)
  csv: string;

  /** Validate only; report errors without importing anything. */
  @IsOptional() @IsBoolean()
  dryRun?: boolean;

  @IsOptional() @IsBoolean()
  sendInvites?: boolean;
}

export class PeopleQuery extends PageQuery {
  @IsOptional() @IsIn(["active", "inactive", "all"])
  status: "active" | "inactive" | "all" = "active";
}

export class StudentsQuery extends PeopleQuery {
  @IsOptional() @IsUUID()
  batchId?: string;

  @IsOptional() @IsUUID()
  courseId?: string;
}

export class CreateStaffDto extends PersonDto {
  @IsIn([Role.INSTITUTE_ADMIN, Role.ACCOUNTANT])
  role: typeof Role.INSTITUTE_ADMIN | typeof Role.ACCOUNTANT;
}
