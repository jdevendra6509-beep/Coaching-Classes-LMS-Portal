import { Transform } from "class-transformer";
import { IsOptional, IsString, Length, Matches, MaxLength } from "class-validator";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

export class UpdateInstituteDto {
  @IsOptional() @Transform(trim) @IsString() @Length(2, 120)
  name?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(200)
  legalName?: string;

  @IsOptional() @Transform(trim) @Matches(/^\+?[0-9]{10,13}$/)
  phone?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toUpperCase() : value))
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, { message: "gstin is not a valid GSTIN" })
  gstin?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(500)
  address?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(80)
  city?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(80)
  state?: string;

  @IsOptional() @Matches(/^[1-9][0-9]{5}$/)
  pincode?: string;
}
