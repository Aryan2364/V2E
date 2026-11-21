import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RefreshTokenDto {
  // Optional: the web app keeps the refresh token in an httpOnly cookie and sends
  // none in the body. Older clients (and a one-time migration of a token still in
  // browser storage) send it here.
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  refresh_token?: string;
}
