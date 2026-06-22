import { IsEmail, IsString, MinLength, Matches, IsOptional } from 'class-validator';

export class SignupDto {
  @IsString() @MinLength(2) workspaceName: string;
  @IsString() @Matches(/^[a-z0-9-]{3,40}$/, { message: 'slug must be lowercase letters, numbers, dashes' })
  slug: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  @IsString() @MinLength(1) firstName: string;
  @IsString() @MinLength(1) lastName: string;
}

export class LoginDto {
  @IsEmail() email: string;
  @IsString() password: string;
  @IsOptional() @IsString() workspaceSlug?: string;
  @IsOptional() @IsString() totp?: string;
}

export class RefreshDto {
  @IsString() refreshToken: string;
}

export class LogoutDto {
  @IsOptional() @IsString() refreshToken?: string;
}

export class MfaStepDto {
  @IsString() ticket: string;
  @IsString() code: string;
}

export class AcceptInviteDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  @IsString() @MinLength(1) firstName: string;
  @IsString() @MinLength(1) lastName: string;
}
