import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class BulkImportHolidayRowDto {
  @IsString() @MaxLength(200) name: string;
  @IsString() @MaxLength(40) date: string;
  @IsOptional() @IsString() @MaxLength(40) type?: string;
  @IsOptional() @IsBoolean() is_recurring_yearly?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
}

export class BulkImportOrgHolidaysDto {
  @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => BulkImportHolidayRowDto)
  holidays: BulkImportHolidayRowDto[];
}
