import { PartialType } from '@nestjs/swagger';
import { CreateKnowledgePostDto } from './create-knowledge-post.dto';

export class UpdateKnowledgePostDto extends PartialType(CreateKnowledgePostDto) {}
