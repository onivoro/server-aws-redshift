import { Module } from '@nestjs/common';
import { moduleFactory } from '@onivoro/server-common';
import { RedshiftDataClient } from '@aws-sdk/client-redshift-data';
import { RedshiftDataService } from './services/redshift.service';
import { ServerAwsRedshiftDataConfig } from './classes/server-aws-redshift-config.class';
import { RedshiftServerlessClient } from '@aws-sdk/client-redshift-serverless';

let redshiftClient: RedshiftDataClient | null = null;
let redshiftServerlessClient: RedshiftServerlessClient | null = null;


@Module({})
export class ServerAwsRedshiftDataModule {
  static configure(config: ServerAwsRedshiftDataConfig) {
    return moduleFactory({
      module: ServerAwsRedshiftDataModule,
      providers: [
        {
          provide: RedshiftDataClient,
          useFactory: () => redshiftClient
            ? redshiftClient
            : redshiftClient = new RedshiftDataClient({
              region: config.AWS_REGION,
              logger: console,
              credentials: config.NODE_ENV === 'production'
                ? undefined
                : {
                  accessKeyId: config.AWS_ACCESS_KEY_ID,
                  secretAccessKey: config.AWS_SECRET_ACCESS_KEY
                }
            })
        },
        {
          provide: RedshiftServerlessClient,
          useFactory: () => redshiftClient
            ? redshiftServerlessClient
            : redshiftServerlessClient = new RedshiftServerlessClient({
              region: config.AWS_REGION,
              logger: console,
              credentials: config.NODE_ENV === 'production'
                ? undefined
                : {
                  accessKeyId: config.AWS_ACCESS_KEY_ID,
                  secretAccessKey: config.AWS_SECRET_ACCESS_KEY
                }
            })
        },
        { provide: ServerAwsRedshiftDataConfig, useValue: config },
        RedshiftDataService
      ]
    })
  }
}
