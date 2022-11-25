
import postgres from 'postgres';

export async function runSchema(sql: postgres.Sql) {
    await sql.begin(s => [
        s`CREATE TABLE mjolnir (local_part VARCHAR(255), owner VARCHAR(255), management_room TEXT);`
    ]);
}
