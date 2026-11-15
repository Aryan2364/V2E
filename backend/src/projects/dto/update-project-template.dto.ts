import { PartialType } from '@nestjs/swagger';
import { CreateProjectTemplateDto } from './create-project-template.dto';

export class UpdateProjectTemplateDto extends PartialType(CreateProjectTemplateDto) {}
