import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAdminDto {
  @IsString() @MaxLength(200) name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(6) @MaxLength(200) password: string;
}

export class ToggleAdminDto {
  @IsBoolean() is_active: boolean;
}

export class UpdateAdminDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsEmail() email: string;
  @IsOptional() @IsString() @MinLength(6) @MaxLength(200) password?: string;
}
