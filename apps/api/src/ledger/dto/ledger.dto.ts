import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountType, ControlAccountType } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

export class CreateAccountDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() companyId!: string;
  @ApiProperty({ example: '1100' }) @Matches(/^[0-9A-Z.-]{2,20}$/) code!: string;
  @ApiProperty() @IsString() @Length(2, 120) name!: string;
  @ApiProperty({ enum: AccountType }) @IsEnum(AccountType) type!: AccountType;
  @ApiPropertyOptional({ enum: ControlAccountType }) @IsOptional() @IsEnum(ControlAccountType) controlType?: ControlAccountType;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() parentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPostable?: boolean;
  @ApiPropertyOptional({ example: 'KES' }) @IsOptional() @Length(3, 3) currency?: string;
}

export class CreatePeriodDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() companyId!: string;
  @ApiProperty({ example: '2026-12' }) @Matches(/^\d{4}-\d{2}$/) code!: string;
  @ApiProperty({ example: '2026-12-01' }) @IsDateString({ strict: true }) startDate!: string;
  @ApiProperty({ example: '2026-12-31' }) @IsDateString({ strict: true }) endDate!: string;
}

export class PeriodTransitionDto {
  @ApiPropertyOptional({ description: 'Required when reopening' }) @IsOptional() @IsString() @Length(3, 500) reason?: string;
}
