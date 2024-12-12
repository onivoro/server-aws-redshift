import { Injectable } from '@nestjs/common';
import { DescribeStatementCommand, ExecuteStatementCommand, RedshiftDataClient } from "@aws-sdk/client-redshift-data";
import { ServerAwsRedshiftDataConfig } from '../classes/server-aws-redshift-config.class';
import { GetWorkgroupCommand, RedshiftServerlessClient } from '@aws-sdk/client-redshift-serverless';
import { randomUUID } from 'crypto';

@Injectable()
export class RedshiftDataService {
    constructor(
        private redshiftDataClient: RedshiftDataClient,
        private redshiftServerlessClient: RedshiftServerlessClient,
        private config: ServerAwsRedshiftDataConfig,
    ) { }

    async waitForStatement(statementId: string) {
        const maxAttempts = 10;
        let attempts = 0;

        while (attempts < maxAttempts) {
            const describeStatementCommand = new DescribeStatementCommand({
                Id: statementId
            });

            const status = await this.redshiftDataClient.send(describeStatementCommand);

            if (status.Status === 'FINISHED') {
                return;
            }

            if (status.Status === 'FAILED') {
                throw new Error(`SQL statement failed: ${status.Error}`);
            }

            attempts++;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        throw new Error('Timeout waiting for SQL statement to complete');
    }

    async verifyEndpointAccess(workgroupName: string) {
        const workgroupResponse = await this.redshiftServerlessClient.send(
            new GetWorkgroupCommand({ workgroupName })
        );

        if (!workgroupResponse?.workgroup?.endpoint?.address) {
            console.error(`Could not retrieve endpoint for workgroup "${workgroupName}"`);

            return;
        }

        return workgroupResponse;
    }

    async addIamUserToDatabaseGroup(params: { Database: string, WorkgroupName: string, User: string, Group: string }) {
        const { Database, WorkgroupName, User, Group } = params;

        try {
            const groupResult = await this.redshiftDataClient.send(new ExecuteStatementCommand({
                Database,
                Sql: `ALTER GROUP ${Group} ADD USER "${User}";`,
                WorkgroupName
            }));

            await this.waitForStatement(groupResult.Id!);

            console.log(`Added user "${User}" to group "${Group}`);
        } catch (error: any) {
            console.warn({ detail: `Warning adding ${User} to group:`, error });
        }
    }

    async createDatabaseUser(params: { Database: string, WorkgroupName: string, User: string }) {
        const { Database, WorkgroupName, User } = params;

        try {

            const checkResult = await this.redshiftDataClient.send(new ExecuteStatementCommand({
                Database,
                Sql: `SELECT u.usename as username FROM pg_user u;`,
                WorkgroupName
            }));

            await this.waitForStatement(checkResult.Id!);

            const describeCommand = new DescribeStatementCommand({ Id: checkResult.Id });
            const checkStatus = await this.redshiftDataClient.send(describeCommand);

            if (!checkStatus.ResultRows) {
                const placeholderPassword = `IAM_${randomUUID().replace(/-/g, '_')}`;

                const createUserCommand = new ExecuteStatementCommand({
                    Database,
                    Sql: `CREATE USER ${User} PASSWORD '${placeholderPassword}';`,
                    WorkgroupName
                });

                const createResult = await this.redshiftDataClient.send(createUserCommand);
                await this.waitForStatement(createResult.Id!);
                console.log(`Created user: ${User}`);
            } else {
                console.log(`User "${User} already exists`);
            }

            return true;
        } catch (error: any) {
            console.warn({detail: `Warning creating user ${User}`, error});
            return false;
        }
    }

    async grantUsageOnSchema(params: { GroupName: string, Database: string, WorkgroupName: string, Schema: string, Group: string }) {
        const { GroupName, Database, WorkgroupName, Schema, Group } = params;

        try {
            const checkResult = await this.redshiftDataClient.send(new ExecuteStatementCommand({
                Database,
                Sql: `SELECT 1 FROM pg_group WHERE groname = '${Group}';`,
                WorkgroupName
            }));

            await this.waitForStatement(checkResult.Id!);

            const describeCommand = new DescribeStatementCommand({ Id: checkResult.Id });
            const checkStatus = await this.redshiftDataClient.send(describeCommand);

            if (!checkStatus.ResultRows) {
                const createGroupCommand = new ExecuteStatementCommand({
                    Database,
                    Sql: 'CREATE GROUP ${Group};',
                    WorkgroupName
                });

                const createResult = await this.redshiftDataClient.send(createGroupCommand);
                await this.waitForStatement(createResult.Id!);
                console.log('Created "${Group}" group');
            } else {
                console.log('"${Group}" group already exists');
            }

            const setupStatements = [
                `GRANT USAGE ON SCHEMA ${Schema} TO GROUP ${Group};`,
                `GRANT SELECT ON ALL TABLES IN SCHEMA ${Schema} TO GROUP ${Group};`,
                `ALTER DEFAULT PRIVILEGES IN SCHEMA ${Schema} GRANT SELECT ON TABLES TO GROUP ${Group};`,
            ];

            for (const Sql of setupStatements) {
                const executeStatementCommand = new ExecuteStatementCommand({
                    Database,
                    Sql,
                    WorkgroupName
                });

                try {
                    const result = await this.redshiftDataClient.send(executeStatementCommand);
                    await this.waitForStatement(result.Id!);
                    console.log(`Executed SQL: ${Sql}`);
                } catch (error: any) {
                    console.warn(`Warning executing SQL: ${Sql}`, error.message);
                }
            }

        } catch (error) {
            console.error({detail: 'Error in grantUsageOnSchema:', error});
            throw error;
        }
    }

    async createDbGroupFromIamGroupIfNotExists(params: {iamGroup: string, Database: string, WorkgroupName: string}): Promise<any> {
        const { iamGroup, Database, WorkgroupName } = params;

        try {
            const checkResult = await this.redshiftDataClient.send(new ExecuteStatementCommand({
                Database,
                Sql: `SELECT 1 FROM pg_group WHERE groname = '${iamGroup}';`,
                WorkgroupName
            }));

            await this.waitForStatement(checkResult.Id!);

            const describeCommand = new DescribeStatementCommand({ Id: checkResult.Id });
            const checkStatus = await this.redshiftDataClient.send(describeCommand);

            if (!checkStatus.ResultRows) {
                const createGroupCommand = new ExecuteStatementCommand({
                    Database,
                    Sql: `CREATE GROUP ${iamGroup};`,
                    WorkgroupName
                });

                const createResult = await this.redshiftDataClient.send(createGroupCommand);
                await this.waitForStatement(createResult.Id!);
                console.log(`Created "${iamGroup}" group`);
            } else {
                console.log(`"${iamGroup}" group already exists`);
            }
        } catch (error: any) {
            console.error({error});
            throw error;
        }
    }
}