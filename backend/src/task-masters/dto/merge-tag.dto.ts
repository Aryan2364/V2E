import { IsNotEmpty, IsString } from 'class-validator';

export class MergeTagDto {
  /** The tag that survives; every task carrying the source tag ends up with this one. */
  @IsString()
  @IsNotEmpty()
  into_tag_id: string;
}
