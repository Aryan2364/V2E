import { Transform } from 'class-transformer'
import { IsOptional, IsString, MaxLength } from 'class-validator'

/**
 * `POST /:id/instances/trigger` — Run. `name` is REQUIRED (1–80 characters after
 * trimming) and unique within the workflow, case- and space-insensitively. The service
 * checks it (not the DTO) so every name error has the same shape:
 * `{ message, code: 'instance_name_required' | 'instance_name_too_long' | 'instance_name_taken', field: 'name' }`.
 */
export class TriggerInstanceDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Enter a name for this instance.' })
  @MaxLength(500)
  name?: string
}
