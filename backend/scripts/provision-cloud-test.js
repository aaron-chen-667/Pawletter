// Run once as an administrator in the application image. No credential values in logs.
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
const root=pathToFileURL(process.cwd()+'/');
const {connectDatabase,transaction}=await import(new URL('src/db.js',root));
const {provision}=await import(new URL('src/auth.js',root));
const {createStorage}=await import(new URL('src/storage.js',root));
const object=process.env.PROVISION_OBJECT;
if(!/^system\/verification\/accounts-[a-f0-9]{32}\.json$/.test(object||''))throw new Error('Invalid output destination');
const suffix=object.slice(-37,-5),db=connectDatabase(),storage=createStorage();
try{
 const accounts=[{username:`station.${suffix.slice(0,12)}`,password:randomBytes(24).toString('base64url'),role:'station',stationId:`test-station-${suffix}`,stationName:'爪爪联调救助站'},
 {username:`adopter.${suffix.slice(0,12)}`,password:randomBytes(24).toString('base64url'),role:'adopter'}];
 await transaction(db,async client=>{
   for(const account of accounts)await provision(client,account);
   await storage.put(object,Buffer.from(JSON.stringify({purpose:'内部联调账号，请勿转发或提交代码仓库。身份未经实名核验。',loginUrl:'https://pawletter-adoption-h5.chenaaron668.chatgpt.site/?mode=online',accounts},null,2)),'application/json');
 });
 console.log(JSON.stringify({provisioned:true,count:2}));
}catch{console.error('TEST_ACCOUNT_PROVISION_FAILED');process.exitCode=1;}
finally{await db.end();}
