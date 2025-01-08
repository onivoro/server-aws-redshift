import { Module } from '@nestjs/common';
import { moduleFactory } from '@onivoro/server-common';
import { RedshiftDataClient } from '@aws-sdk/client-redshift-data';
import { RedshiftDataService } from './services/redshift.service';
import { ServerAwsRedshiftDataConfig } from './classes/server-aws-redshift-config.class';
import { RedshiftServerlessClient } from '@aws-sdk/client-redshift-serverless';
import { RedshiftClient } from '@aws-sdk/client-redshift';

let redshiftClient: RedshiftClient | null = null;
let redshiftDataClient: RedshiftDataClient | null = null;
let redshiftServerlessClient: RedshiftServerlessClient | null = null;


@Module({})
export class ServerAwsRedshiftDataModule {
  static configure(config: ServerAwsRedshiftDataConfig) {
    return moduleFactory({
      module: ServerAwsRedshiftDataModule,
      providers: [
        {
          provide: RedshiftDataClient,
          useFactory: () => redshiftDataClient
            ? redshiftDataClient
            : redshiftDataClient = new RedshiftDataClient(from(config))
        },
        {
          provide: RedshiftServerlessClient,
          useFactory: () => redshiftServerlessClient
            ? redshiftServerlessClient
            : redshiftServerlessClient = new RedshiftServerlessClient(from(config))
        },
        {
          provide: RedshiftClient,
          useFactory: () => redshiftClient
            ? redshiftClient
            : redshiftClient = new RedshiftClient(from(config))
        },
        { provide: ServerAwsRedshiftDataConfig, useValue: config },
        RedshiftDataService
      ]
    })
  }
}

function from(config: ServerAwsRedshiftDataConfig) {
  return {
    region: config.AWS_REGION,
    logger: console,
    credentials: config.NODE_ENV === 'production'
      ? undefined
      : {
        accessKeyId: config.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.AWS_SECRET_ACCESS_KEY
      }
  };
}
