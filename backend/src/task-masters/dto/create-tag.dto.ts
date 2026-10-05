import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { TAG_COLORS, TAG_DESCRIPTION_MAX_LENGTH, TAG_NAME_MAX_LENGTH } from '../task-tag.constants';
import type { TagColor } from '../task-tag.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateTagDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Tag name is required' })
  @MaxLength(TAG_NAME_MAX_LENGTH, { message: `Tag names can be at most ${TAG_NAME_MAX_LENGTH} characters` })
  @Matches(/^[^|,]*$/, { message: 'Tag names cannot contain commas or pipes' })
  name: string;

  // Omitted → the server picks the least-used palette colour in the org.
  @IsOptional()
  @IsIn(TAG_COLORS as unknown as string[], { message: `color must be one of: ${TAG_COLORS.join(', ')}` })
  color?: TagColor;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(TAG_DESCRIPTION_MAX_LENGTH)
  description?: string;
}
