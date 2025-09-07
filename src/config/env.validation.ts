import { plainToInstance } from 'class-transformer';
import { IsEnum, IsNumber, Max, Min, validateSync } from 'class-validator';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
  Provision = 'provision',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment;

  @IsNumber()
  @Min(0)
  @Max(65535)
  PORT: number;
  SQUADCO_BASE_URL: string;
  SQUADCO_SECRET_KEY: string;
  SQUADCO_MID: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return validatedConfig;
}


@Injectable()
export class ApiConfigService {
  constructor(private configService: ConfigService) {}

  get port(): number {
    return this.configService.get<number>('PORT') as number;
  }

  get squadBaseUrl(): string {
    return this.configService.get<string>('SQUADCO_BASE_URL') as string;
  }

  get squadSecretKey(): string {
    return this.configService.get<string>('SQUADCO_SECRET_KEY') as string;
  }

  get squadMID(): string {
    return this.configService.get<string>('SQUADCO_MID') as string;
  }
}



