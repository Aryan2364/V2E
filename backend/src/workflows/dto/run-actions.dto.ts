import { Transform } from 'class-transformer'
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

export const SEND_BACK_REASON_MIN = 5
export const SEND_BACK_REASON_MAX = 2000

/** `POST /:id/instances/:iid/steps/:rowId/send-back` */
export class SendBackDto {
  @IsUUID('all', { message: 'Choose the step to send it back to.' })
  to_row_id: string

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Enter a reason.' })
  @IsNotEmpty({ message: 'Enter a reason.' })
  @MinLength(SEND_BACK_REASON_MIN, {
    message: `Enter a reason of at least ${SEND_BACK_REASON_MIN} characters.`,
  })
  @MaxLength(SEND_BACK_REASON_MAX, {
    message: `Keep the reason under ${SEND_BACK_REASON_MAX} characters.`,
  })
  reason: string
}

/** `POST /:id/instances/:iid/skip-step` — `row_id` omitted = the single current step. */
export class SkipStepDto {
  @IsOptional()
  @IsUUID('all', { message: 'Choose the step to skip.' })
  row_id?: string
}
