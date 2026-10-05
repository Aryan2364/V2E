import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { TAG_COLORS, TAG_DESCRIPTION_MAX_LENGTH, TAG_NAME_MAX_LENGTH } from '../task-tag.constants';
import type { TagColor } from '../task-tag.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * A real partial update — every field optional, unlike the category/priority
 * PATCH routes that reuse their Create DTO and so force `name` on every edit.
 * `description: null` (or "") clears it.
 */
export class UpdateTagDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Tag name cannot be empty' })
  @MaxLength(TAG_NAME_MAX_LENGTH, { message: `Tag names can be at most ${TAG_NAME_MAX_LENGTH} characters` })
  @Matches(/^[^|,]*$/, { message: 'Tag names cannot contain commas or pipes' })
  name?: string;

  @IsOptional()
  @IsIn(TAG_COLORS as unknown as string[], { message: `color must be one of: ${TAG_COLORS.join(', ')}` })
  color?: TagColor;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(TAG_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
