import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  // Email OR phone number — the user signs in with whichever they have on file.
  // When `identifier` is a phone number, `country_code` says which country it
  // belongs to; the pair (country_code, national digits) is what's matched.
  @ApiProperty({ description: 'Email address or phone number' })
  @IsString()
  @IsNotEmpty({ message: 'Enter your email address or mobile number.' })
  identifier: string;

  @ApiPropertyOptional({ description: 'Dialling country code (e.g. "+91") — only used when the identifier is a phone number' })
  @IsString()
  @IsOptional()
  country_code?: string;

  // No length rule here: the password policy belongs to sign-up and reset. On sign-in
  // a short password is simply a wrong one, and gets the same refusal as any other
  // (auth.messages.ts), instead of a 400 that describes the policy.
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Enter your password.' })
  password: string;
}
