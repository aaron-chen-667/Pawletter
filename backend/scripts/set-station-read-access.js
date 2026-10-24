import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {connectDatabase,transaction} from '../src/db.js';
import {assert} from '../src/errors.js';

const inputSchema=z.object({username:z.string().regex(/^[a-zA-Z0-9._-]{3,64}$/),enabled:z.boolean()}).strict();

export async function setStationReadAccess(db,input){
 const {username,enabled}=inputSchema.parse(input);
 return transaction(db,async client=>{
  const user=(await client.query("UPDATE users SET read_all_stations=$2 WHERE username=$1 AND role='station' AND active=true RETURNING id,username,station_id,read_all_stations",[username,enabled])).rows[0];
  assert(user,404,'ACTIVE_STATION_USER_REQUIRED');
  // The operator is an external administrator, not the user receiving access.
  await client.query('INSERT INTO audit_events(id,actor_id,action,target_id) VALUES($1,$2,$3,$4)',[randomUUID(),null,enabled?'station.read_all_stations.granted':'station.read_all_stations.revoked',user.id]);
  return {id:user.id,username:user.username,stationId:user.station_id,canReadAllStations:user.read_all_stations};
 });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let db,input='';
 try{
  // Administrative stdin only; never expose this operation through the API.
  for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>10000)throw new Error('INPUT_TOO_LARGE');}
  const request=inputSchema.parse(JSON.parse(input));
  db=connectDatabase();
  console.log(JSON.stringify(await setStationReadAccess(db,request)));
 }catch{
  console.error('Station read access update failed; check input, active station account, migration and database permissions.');
  process.exitCode=1;
 }finally{
  input='';
  try{await db?.end();}catch{console.error('Database connection cleanup failed.');process.exitCode=1;}
 }
}
