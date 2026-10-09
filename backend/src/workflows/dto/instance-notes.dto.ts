import { Transform } from 'class-transformer'
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'

export const NOTE_BODY_MAX = 2000

/** `POST /:id/instances/:iid/notes` */
export class CreateInstanceNoteDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Write a note.' })
  @IsNotEmpty({ message: 'Write a note.' })
  @MaxLength(NOTE_BODY_MAX, { message: `Keep the note to ${NOTE_BODY_MAX} characters or fewer.` })
  body: string

  /** A later step of this instance (not done or skipped) the note is for; omitted/null = the whole instance. */
  @IsOptional()
  @IsUUID('all', { message: 'Choose a step of this instance.' })
  for_row_id?: string | null
}

/** `POST /:id/change-creator` (admins) — the new permanent editor. */
export class ChangeCreatorDto {
  @IsUUID('all', { message: 'Choose a person.' })
  user_id: string
}
