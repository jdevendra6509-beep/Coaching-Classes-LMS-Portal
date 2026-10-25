import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsHexColor, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min,
  ValidateIf, ValidateNested,
} from "class-validator";
import { PageQuery } from "../common/pagination.js";
import { FIELD_KEYS, type FieldKey } from "../pdf/certificate.js";
import { DATE_FORMATS, type DateFormat, type FontName, FONTS } from "../pdf/text.js";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

export class TemplateFieldDto {
  @ValidateIf((o: TemplateFieldDto) => !o.text)
  @IsIn(FIELD_KEYS)
  key?: FieldKey;

  @ValidateIf((o: TemplateFieldDto) => !o.key)
  @IsString() @Length(1, 500)
  text?: string;

  @IsNumber() @Min(0) @Max(5000)
  x: number;

  @IsNumber() @Min(0) @Max(5000)
  y: number;

  @IsOptional() @IsNumber() @Min(4) @Max(200)
  fontSize?: number;

  @IsOptional() @IsIn(Object.keys(FONTS))
  font?: FontName;

  @IsOptional() @IsHexColor()
  color?: string;

  @IsOptional() @IsIn(["left", "center", "right"])
  align?: "left" | "center" | "right";

  @IsOptional() @IsNumber() @Min(10) @Max(5000)
  maxWidth?: number;

  @IsOptional() @IsInt() @Min(30) @Max(400)
  size?: number;

  @IsOptional() @IsIn(DATE_FORMATS)
  dateFormat?: DateFormat;
}

export class TemplateUploadDto {
  @Transform(trim) @IsString() @Length(1, 255)
  fileName: string;

  @IsIn(["application/pdf", "image/png", "image/jpeg"], { message: "The background must be a PDF, PNG or JPEG" })
  mimeType: string;

  @IsInt() @Min(1) @Max(15 * 1024 * 1024, { message: "The background must be 15 MB or smaller" })
  sizeBytes: number;
}

export class CreateTemplateDto {
  @Transform(trim) @IsString() @Length(2, 120)
  name: string;

  @IsString()
  uploadToken: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => TemplateFieldDto)
  fields: TemplateFieldDto[];
}

export class UpdateTemplateDto {
  @IsOptional() @Transform(trim) @IsString() @Length(2, 120)
  name?: string;

  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => TemplateFieldDto)
  fields?: TemplateFieldDto[];
}

export class AssignTemplateDto {
  /** null removes the course's template. */
  @ValidateIf((_, v) => v !== null) @IsUUID()
  templateId: string | null;
}

export class RevokeDto {
  @Transform(trim) @IsString() @Length(3, 500)
  reason: string;
}

export class CertificatesQuery extends PageQuery {
  @IsOptional() @IsUUID()
  courseId?: string;

  @IsOptional() @IsUUID()
  studentId?: string;
}

export class VerifyParam {
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toUpperCase() : value))
  @IsString() @MaxLength(40)
  code: string;
}
