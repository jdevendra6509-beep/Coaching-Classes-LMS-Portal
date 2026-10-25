import { Transform, Type } from "class-transformer";
import {
  IsBoolean, IsEmail, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min,
} from "class-validator";
import { InstituteStatus } from "@lms/db";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);
const lowerTrim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim().toLowerCase() : value);

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export class SignupDto {
  @Transform(trim) @IsString() @Length(2, 120)
  instituteName: string;

  /** Becomes the subdomain: <slug>.platform.in */
  @Transform(lowerTrim) @Matches(SLUG_PATTERN, { message: "slug must be 3-40 lowercase letters, digits or hyphens" })
  slug: string;

  @Transform(trim) @IsString() @Length(2, 120)
  ownerName: string;

  @Transform(lowerTrim) @IsEmail()
  email: string;

  @Transform(trim) @Matches(/^\+?[0-9]{10,13}$/, { message: "phone must be 10-13 digits" })
  phone: string;

  @IsString() @MaxLength(40)
  planCode: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(80)
  city?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(80)
  state?: string;
}

export class CreatePlanDto {
  @Matches(/^[a-z0-9-]{2,40}$/)
  code: string;

  @Transform(trim) @IsString() @Length(2, 80)
  name: string;

  /** INR per month, excluding GST. */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(1)
  pricePerMonth: number;

  @IsInt() @Min(1)
  maxStudents: number;

  @IsInt() @Min(1)
  maxStorageMb: number;
}

export class UpdatePlanDto {
  @IsOptional() @Transform(trim) @IsString() @Length(2, 80)
  name?: string;

  @IsOptional() @IsInt() @Min(1)
  maxStudents?: number;

  @IsOptional() @IsInt() @Min(1)
  maxStorageMb?: number;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class ListInstitutesQuery {
  @IsOptional() @IsEnum(InstituteStatus)
  status?: InstituteStatus;

  @IsOptional() @IsString() @MaxLength(100)
  search?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize = 25;
}

export class SuspendDto {
  @Transform(trim) @IsString() @Length(3, 500)
  reason: string;
}

export class SlugQuery {
  @Transform(lowerTrim) @IsString() @MaxLength(60)
  slug: string;
}

export class ListPaymentsQuery {
  @IsOptional() @IsUUID()
  instituteId?: string;

  @IsOptional() @IsIn(["CREATED", "AUTHORIZED", "CAPTURED", "FAILED", "REFUNDED"])
  status?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize = 25;
}
