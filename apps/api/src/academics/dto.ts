import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize, ArrayUnique, IsArray, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length,
  Matches, Max, MaxLength, Min, ValidateNested,
} from "class-validator";
import { AttendanceStatus, CourseStatus } from "@lms/db";
import { PageQuery } from "../common/pagination.js";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

export class CreateCourseDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9][A-Z0-9_-]{0,29}$/, { message: "code must be up to 30 letters, digits, - or _" })
  code: string;

  @Transform(trim) @IsString() @Length(2, 200)
  name: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(5000)
  description?: string;

  @IsOptional() @IsInt() @Min(1) @Max(520)
  durationWeeks?: number;

  /** Total course fee in INR (GST handling comes with invoicing). */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  fee: number;

  @IsOptional() @IsEnum(CourseStatus)
  status?: CourseStatus;
}

export class UpdateCourseDto {
  @IsOptional() @Transform(({ value }) => (typeof value === "string" ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9][A-Z0-9_-]{0,29}$/)
  code?: string;

  @IsOptional() @Transform(trim) @IsString() @Length(2, 200)
  name?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(5000)
  description?: string;

  @IsOptional() @IsInt() @Min(1) @Max(520)
  durationWeeks?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  fee?: number;

  @IsOptional() @IsEnum(CourseStatus)
  status?: CourseStatus;
}

export class CoursesQuery extends PageQuery {
  @IsOptional() @IsEnum(CourseStatus)
  status?: CourseStatus;
}

export class CreateBatchDto {
  @IsUUID()
  courseId: string;

  @Transform(trim) @IsString() @Length(1, 120)
  name: string;

  @IsDateString({ strict: true })
  startDate: string;

  @IsOptional() @IsDateString({ strict: true })
  endDate?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(200)
  schedule?: string;

  @IsOptional() @IsInt() @Min(1) @Max(10_000)
  capacity?: number;

  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(50) @IsUUID("all", { each: true })
  teacherIds?: string[];
}

export class UpdateBatchDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 120)
  name?: string;

  @IsOptional() @IsDateString({ strict: true })
  startDate?: string;

  @IsOptional() @IsDateString({ strict: true })
  endDate?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(200)
  schedule?: string;

  @IsOptional() @IsInt() @Min(1) @Max(10_000)
  capacity?: number;
}

export class BatchesQuery extends PageQuery {
  @IsOptional() @IsUUID()
  courseId?: string;

  /** "current": not yet ended. */
  @IsOptional() @IsIn(["current", "ended", "all"])
  when: "current" | "ended" | "all" = "all";
}

export class TeacherIdsDto {
  @IsArray() @ArrayUnique() @ArrayMaxSize(50) @IsUUID("all", { each: true })
  teacherIds: string[];
}

export class StudentIdsDto {
  @IsArray() @ArrayUnique() @ArrayMaxSize(500) @IsUUID("all", { each: true })
  studentIds: string[];
}

export class EnrollDto {
  @IsUUID()
  studentId: string;

  @IsUUID()
  batchId: string;
}

export class AttendanceRecordDto {
  @IsUUID()
  studentId: string;

  @IsEnum(AttendanceStatus)
  status: AttendanceStatus;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(200)
  remark?: string;
}

export class MarkAttendanceDto {
  @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => AttendanceRecordDto)
  records: AttendanceRecordDto[];
}

export class DateRangeQuery {
  @IsOptional() @IsDateString({ strict: true })
  from?: string;

  @IsOptional() @IsDateString({ strict: true })
  to?: string;
}

export class StudentAttendanceQuery extends DateRangeQuery {
  @IsOptional() @IsUUID()
  batchId?: string;
}
