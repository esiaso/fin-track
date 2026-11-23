import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsDateString, IsEnum, IsIn, IsOptional, IsString, IsUUID, Length, Matches, ValidateNested } from 'class-validator';

const AMOUNT = /^\d{1,16}(\.\d{1,4})?$/;

export class NoteDto {
  @ApiProperty() @IsString() @Length(3, 500) note!: string;
}

export class ControlDto {
  @ApiProperty({ enum: ['NONE', 'DISPUTED', 'ON_HOLD'] }) @IsIn(['NONE', 'DISPUTED', 'ON_HOLD']) state!: 'NONE' | 'DISPUTED' | 'ON_HOLD';
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class RunItemDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() invoiceId!: string;
  @ApiProperty({ example: '1000.00' }) @Matches(AMOUNT) amount!: string;
}

export class CreateRunDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() companyId!: string;
  @ApiProperty({ example: '2026-11-30' }) @IsDateString({ strict: true }) paymentDate!: string;
  @ApiProperty({ example: 'KES' }) @Length(3, 3) currency!: string;
  @ApiPropertyOptional({ enum: ['BANK_TRANSFER', 'MPESA', 'CHEQUE'] }) @IsOptional() @IsEnum(['BANK_TRANSFER', 'MPESA', 'CHEQUE']) method?: 'BANK_TRANSFER' | 'MPESA' | 'CHEQUE';
  @ApiPropertyOptional({ example: 'BANK:DEFAULT' }) @IsOptional() @Matches(/^BANK:[A-Z0-9_]+$/) bankMappingKey?: string;
  @ApiProperty({ type: [RunItemDto] }) @ValidateNested({ each: true }) @Type(() => RunItemDto) @ArrayMinSize(1) items!: RunItemDto[];
}

export class ItemResultDto {
  @ApiProperty({ enum: ['PAID', 'FAILED'], description: 'FAILED on a PAID item records a bank return and reverses the payment' })
  @IsIn(['PAID', 'FAILED']) status!: 'PAID' | 'FAILED';
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 120) bankReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 500) reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) valueDate?: string;
}
