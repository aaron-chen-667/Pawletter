import {z} from 'zod';
// These are expression preferences, never new facts about the animal.
export const voiceSchema=z.object({tone:z.enum(['gentle','shy','calm','lively']),style:z.string().trim().max(200).default('')}).strict();
export const petProfileSchema=z.object({species:z.enum(['cat','dog']),description:z.string().max(4000).default(''),character:z.string().max(500).default(''),age:z.string().max(80).default(''),city:z.string().max(80).default(''),sex:z.enum(['male','female','unknown']).default('unknown'),photoUrl:z.union([z.url().refine(v=>v.startsWith('https://')),z.literal('')]).default(''),latitude:z.number().min(-90).max(90).optional(),longitude:z.number().min(-180).max(180).optional(),internal:z.boolean().default(false)}).strict();
export function defaultVoice(profile){
 const character=profile.character||'';
 return {tone:/慢热|胆小|谨慎/.test(character)?'shy':/安静|独立/.test(character)?'calm':/活泼|热情|好动/.test(character)?'lively':'gentle',style:''};
}
export async function readAgent(db,pet){
 const row=(await db.query('SELECT * FROM pet_agents WHERE pet_id=$1',[pet.id])).rows[0];
 return {petId:pet.id,voice:row?.voice||defaultVoice(pet.profile),revision:row?.revision||1,factSource:'rescue_archive'};
}
export const voiceDirections={gentle:'温柔、自然，不夸张卖萌',shy:'慢热、略带腼腆，语气轻轻的',calm:'安静、简洁，留有舒服的空间',lively:'轻快、热情，表达有活力但不吵闹'};
