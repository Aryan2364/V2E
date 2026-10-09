import { IsUUID } from 'class-validator'

// Instance notes are now messages of the instance discussion (dto/discussion.dto.ts).

/** `POST /:id/change-creator` (admins) — the new permanent editor. */
export class ChangeCreatorDto {
  @IsUUID('all', { message: 'Choose a person.' })
  user_id: string
}
