import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsString, ValidateNested } from 'class-validator';

export class ReorderItemDto {
  @IsString() id: string;
  @IsInt() order_index: number;
}

export class ReorderItemsDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ReorderItemDto)
  items: ReorderItemDto[];
}
