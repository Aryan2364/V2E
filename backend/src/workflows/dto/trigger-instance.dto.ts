import { Transform } from 'class-transformer'
import { IsOptional, IsString, MaxLength } from 'class-validator'

/** Manual start. `name` is optional — the engine defaults it to "<workflow> — <date>". */
export class TriggerInstanceDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  name?: string
}
