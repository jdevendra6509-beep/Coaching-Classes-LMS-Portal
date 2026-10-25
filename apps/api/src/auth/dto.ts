import { Transform } from "class-transformer";
import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from "class-validator";

const lowerTrim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim().toLowerCase() : value);

export class PasswordField {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}

export class LoginDto {
  @Transform(lowerTrim)
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(128)
  password: string;

  /** 6-digit authenticator code, required when the account has MFA enabled. */
  @IsOptional()
  @Matches(/^\d{6}$/)
  otp?: string;
}

export class TokenPasswordDto extends PasswordField {
  @IsString()
  @Length(20, 200)
  token: string;
}

export class ForgotPasswordDto {
  @Transform(lowerTrim)
  @IsEmail()
  email: string;
}

export class OtpDto {
  @Matches(/^\d{6}$/)
  code: string;
}
