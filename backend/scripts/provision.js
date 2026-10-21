import { connectDatabase, transaction } from '../src/db.js';
import { provision } from '../src/auth.js';
// Read administrator-supplied account JSON from stdin. Never place passwords in CLI arguments or logs.
let input='';for await (const chunk of process.stdin){input+=chunk;if(input.length>10000)throw new Error('Input too large');}
const db=connectDatabase();
try {const id=await transaction(db,client=>provision(client,JSON.parse(input)));console.log(JSON.stringify({id,created:true}));}
catch {console.error('Account provisioning failed; check input, existing username and database permissions.');process.exitCode=1;}
finally {input='';await db.end();}
