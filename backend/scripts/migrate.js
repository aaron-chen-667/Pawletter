import { connectDatabase, migrate } from '../src/db.js';
const db=connectDatabase();
try {await migrate(db);console.log('Database schema ready');}
catch {console.error('Migration failed; check database access and migration permissions.');process.exitCode=1;}
finally {await db.end();}
