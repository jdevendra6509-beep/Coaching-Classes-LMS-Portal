import { Transform } from "class-transformer";
import {
  ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, IsUUID, Length, MaxLength, Min, ValidateIf,
} from "class-validator";
import { MaterialType } from "@lms/db";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

export class UploadRequestDto {
  @Transform(trim) @IsString() @Length(1, 255)
  fileName: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value)) @IsString() @MaxLength(150)
  mimeType: string;

  @IsInt() @Min(1)
  sizeBytes: number;
}

export class CreateMaterialDto {
  @Transform(trim) @IsString() @Length(1, 200)
  title: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(5000)
  description?: string;

  /** From POST …/materials/upload-url, after the file has been PUT to the returned URL. */
  @ValidateIf((o: CreateMaterialDto) => !o.externalUrl)
  @IsString()
  uploadToken?: string;

  /** Instead of a file: an https link (e.g. an unlisted YouTube/Vimeo video or a Google Drive doc). */
  @ValidateIf((o: CreateMaterialDto) => !o.uploadToken)
  @IsUrl({ protocols: ["https"], require_protocol: true }, { message: "externalUrl must be an https:// link" })
  @MaxLength(2000)
  externalUrl?: string;

  /** For links only: LINK (default) or VIDEO. Uploaded files get their type from the file. */
  @IsOptional() @IsIn([MaterialType.LINK, MaterialType.VIDEO])
  linkType?: typeof MaterialType.LINK | typeof MaterialType.VIDEO;

  @IsOptional() @IsUUID()
  moduleId?: string;

  @IsOptional() @IsBoolean()
  isPublished?: boolean;
}

export class UpdateMaterialDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 200)
  title?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(5000)
  description?: string;

  /** null moves it out of any module. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  moduleId?: string | null;

  @IsOptional() @IsBoolean()
  isPublished?: boolean;
}

export class OrderMaterialsDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  moduleId: string | null = null;

  @IsArray() @ArrayUnique() @ArrayMaxSize(1000) @IsUUID("all", { each: true })
  materialIds: string[];
}

export class ModuleDto {
  @Transform(trim) @IsString() @Length(1, 200)
  title: string;
}

export class OrderModulesDto {
  @IsArray() @ArrayUnique() @ArrayMaxSize(500) @IsUUID("all", { each: true })
  moduleIds: string[];
}

export class DownloadQuery {
  /** Open in the browser (PDFs, images, video) instead of saving. */
  @IsOptional() @Transform(({ value }) => value === true || value === "true" || value === "1") @IsBoolean()
  inline?: boolean;
}

export class LogoUploadDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value)) @IsString()
  mimeType: string;

  @IsInt() @Min(1)
  sizeBytes: number;
}

export class ConfirmLogoDto {
  @IsString()
  uploadToken: string;
}
