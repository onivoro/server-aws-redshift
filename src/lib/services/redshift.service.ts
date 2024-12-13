import { Injectable } from '@nestjs/common';
import { DescribeStatementCommand, ExecuteStatementCommand, RedshiftDataClient } from "@aws-sdk/client-redshift-data";
import { GetWorkgroupCommand, RedshiftServerlessClient } from '@aws-sdk/client-redshift-serverless';
import { randomUUID } from 'crypto';

@Injectable()
export class RedshiftDataService {
    constructor(
        private redshiftDataClient: RedshiftDataClient,
        private redshiftServerlessClient: RedshiftServerlessClient,
    ) { }

    async waitForStatement(statementId: string, maxAttempts = 10, delay = 1000) {
        let attempts = 0;

        while (attempts < maxAttempts) {
            const describeStatementCommand = new DescribeStatementCommand({
                Id: statementId
            });

            const status = await this.redshiftDataClient.send(describeStatementCommand);

            if (status.Status === 'FINISHED') {
                return status.ResultRows;
            }

            if (status.Status === 'FAILED') {
                throw new Error(`SQL statement failed: ${status.Error}`);
            }

            attempts++;
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        throw new Error('Timeout waiting for SQL statement to complete');
    }

    async verifyEndpointAccess(workgroupName: string) {
        const workgroupResponse = await this.redshiftServerlessClient.send(
            new GetWorkgroupCommand({ workgroupName })
        );

        if (!workgroupResponse?.workgroup?.endpoint?.address) {
            console.error(`Could not retrieve endpoint for workgroupName "${workgroupName}"`);

            return;
        }

        return workgroupResponse;
    }

    async addIamUserToDatabaseGroup(_: { database: string, workgroupName: string, user: string, group: string }) {
        try {
            const groupResult = await this.redshiftDataClient.send(new ExecuteStatementCommand({
                Database: _.database,
                Sql: `ALTER GROUP ${_.group} ADD USER "${_.user}";`,
                WorkgroupName: _.workgroupName
            }));

            await this.waitForStatement(groupResult.Id!);

            console.log(`Added user "${_.user}" to group "${_.group}`);
        } catch (error: any) {
            console.warn({ detail: `Warning adding ${_.user} to group:`, error });
        }
    }

    async createDatabaseUser(_: { database: string, workgroupName: string, user: string }): Promise<string> {
        try {

            const checkResult = await this.redshiftDataClient.send(new ExecuteStatementCommand({
                Database: _.database,
                Sql: `SELECT u.usename as username FROM pg_user u;`,
                WorkgroupName: _.workgroupName
            }));

            await this.waitForStatement(checkResult.Id!);

            const describeCommand = new DescribeStatementCommand({ Id: checkResult.Id });
            const checkStatus = await this.redshiftDataClient.send(describeCommand);

            if (!checkStatus.ResultRows) {
                const placeholderPassword = `IAM_${randomUUID().replace(/-/g, '_')}`;

                const createUserCommand = new ExecuteStatementCommand({
                    Database: _.database,
                    Sql: `CREATE USER ${_.user} PASSWORD '${placeholderPassword}';`,
                    WorkgroupName: _.workgroupName
                });

                const createResult = await this.redshiftDataClient.send(createUserCommand);

                await this.waitForStatement(createResult.Id!);

                console.log(`Created user: ${_.user}`);

                return placeholderPassword;
            } else {
                console.log(`User "${_.user} already exists`);

                return '';
            }

        } catch (error: any) {
            console.warn({ detail: `Warning creating user ${_.user}`, error });
            throw error;
        }
    }

    async grantUsageOnSchema(_: { database: string, workgroupName: string, schema: string, group: string }) {

        try {
            const setupStatements = [
                `GRANT USAGE ON SCHEMA ${_.schema} TO GROUP ${_.group};`,
                `GRANT SELECT ON ALL TABLES IN SCHEMA ${_.schema} TO GROUP ${_.group};`,
                `ALTER DEFAULT PRIVILEGES IN SCHEMA ${_.schema} GRANT SELECT ON TABLES TO GROUP ${_.group};`,
            ];

            for (const Sql of setupStatements) {
                const executeStatementCommand = new ExecuteStatementCommand({
                    Database: _.database,
                    Sql,
                    WorkgroupName: _.workgroupName
                });

                try {
                    const result = await this.redshiftDataClient.send(executeStatementCommand);
                    await this.waitForStatement(result.Id!);
                    console.log(Sql);
                } catch (error: any) {
                    console.warn({ Sql, error });
                }
            }

        } catch (error) {
            console.error({ error });
            throw error;
        }
    }

    async createDbGroupFromIamGroupIfNotExists(_: { iamGroup: string, database: string, workgroupName: string }): Promise<any> {

        try {
            const checkResult = await this.redshiftDataClient.send(new ExecuteStatementCommand({
                Database: _.database,
                Sql: `SELECT 1 FROM pg_group WHERE groname = '${_.iamGroup}';`,
                WorkgroupName: _.workgroupName
            }));

            await this.waitForStatement(checkResult.Id!);

            const describeCommand = new DescribeStatementCommand({ Id: checkResult.Id });
            const checkStatus = await this.redshiftDataClient.send(describeCommand);

            if (!checkStatus.ResultRows) {
                const createGroupCommand = new ExecuteStatementCommand({
                    Database: _.database,
                    Sql: `CREATE GROUP ${_.iamGroup};`,
                    WorkgroupName: _.workgroupName
                });

                const createResult = await this.redshiftDataClient.send(createGroupCommand);
                await this.waitForStatement(createResult.Id!);
                console.log(`Created "${_.iamGroup}" group`);
            } else {
                console.log(`"${_.iamGroup}" group already exists`);
            }
        } catch (error: any) {
            console.error({ error });
            throw error;
        }
    }

    async query(_: { database: string, workgroupName: string }, Sql: string) {
        const result = await this.redshiftDataClient.send(new ExecuteStatementCommand({
            Database: _.database,
            Sql,
            WorkgroupName: _.workgroupName
        }));

        return await this.waitForStatement(result.Id!);
    }
}