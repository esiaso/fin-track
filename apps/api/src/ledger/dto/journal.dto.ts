import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsDateString, IsObject, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, ValidateNested } from 'class-validator';

const AMOUNT = /^\d{1,16}(\.\d{1,4})?$/;
const RATE = /^\d{1,10}(\.\d{1,10})?$/;

export class JournalLineInput {
  @ApiProperty({ format: 'uuid' }) @IsUUID() accountId!: string;
  @ApiProperty({ example: 'KES' }) @IsString() @Length(3, 3) currency!: string;
  @ApiProperty({ example: '1000.00', description: 'Decimal string, max 4dp' }) @Matches(AMOUNT) debit!: string;
  @ApiProperty({ example: '0' }) @Matches(AMOUNT) credit!: string;
  @ApiPropertyOptional({ example: '1', description: 'Rate to company base currency; required when currency != base' })
  @IsOptional() @Matches(RATE) fxRate?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() facilityId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) @IsOptional() @IsObject() dimensions?: Record<string, unknown>;
}

export class CreateJournalDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() companyId!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() facilityId?: string;
  @ApiProperty({ example: '2026-11-22' }) @IsDateString({ strict: true }) journalDate!: string;
  @ApiProperty() @IsString() @Length(3, 500) description!: string;
  @ApiProperty({ type: [JournalLineInput] })
  @ValidateNested({ each: true }) @Type(() => JournalLineInput) @ArrayMinSize(2)
  lines!: JournalLineInput[];
}

export class ReverseJournalDto {
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
  @ApiPropertyOptional({ description: 'Reversal date; defaults to original date if its period is open, else today' })
  @IsOptional() @IsDateString({ strict: true }) reversalDate?: string;
}
