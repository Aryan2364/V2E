import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

/** Longest message, in characters. */
export const MESSAGE_BODY_MAX = 2000
/** Most people one message may @mention. */
export const MENTION_MAX = 20
/** Top-level messages per page, by default and at most. */
export const DISCUSSION_PAGE = 30
export const DISCUSSION_PAGE_MAX = 100

/** `POST /:id/instances/:iid/discussion` */
export class PostDiscussionMessageDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Write a message.' })
  @MaxLength(MESSAGE_BODY_MAX, { message: `Keep the message to ${MESSAGE_BODY_MAX} characters or fewer.` })
  body?: string

  /** The message this answers (any message of this instance; replies stay one level deep). */
  @IsOptional()
  @IsUUID('all', { message: 'Choose a message of this discussion to reply to.' })
  reply_to_id?: string | null

  /** "For <later step>": a step of this instance that isn't done or skipped. */
  @IsOptional()
  @IsUUID('all', { message: 'Choose a step of this instance.' })
  for_row_id?: string | null

  /** People @mentioned — only people who can see the instance are kept. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MENTION_MAX, { message: `Mention at most ${MENTION_MAX} people in one message.` })
  @IsUUID('all', { each: true, message: 'Choose people from the list.' })
  mention_user_ids?: string[]

  /** Set when written on a step's task page: that task (must belong to this instance). */
  @IsOptional()
  @IsUUID('all', { message: 'That task isn’t part of this instance.' })
  task_id?: string | null

  /** Files follow in separate uploads, so the text may be empty. */
  @IsOptional()
  @IsBoolean()
  with_files?: boolean
}

/** `GET /:id/instances/:iid/discussion?before=&limit=` */
export class DiscussionQueryDto {
  /** Load the messages before this one (older page). */
  @IsOptional()
  @IsUUID('all', { message: 'Unknown message.' })
  before?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(DISCUSSION_PAGE_MAX)
  limit?: number
}
