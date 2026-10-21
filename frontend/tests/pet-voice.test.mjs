import {test} from 'node:test';
import assert from 'node:assert/strict';
import {petJourneyMessage} from '../dist/pet-voice.js';
test('pet journey tone follows personality without changing pending status',()=>{
 const shy=petJourneyMessage({character:'慢热，熟悉后亲人'},'submitted'),active=petJourneyMessage({character:'活泼、热情'},'submitted');
 assert.notEqual(shy,active);assert.match(shy,/紧张/);assert.match(shy,/申请/);assert.match(active,/审核/);assert.doesNotMatch(shy+active,/已通过|审核通过|领养成功|交接完成/);
 assert.match(petJourneyMessage({character:'安静'},'adopted'),/交接完成/);assert.equal(petJourneyMessage({},'unknown'),'');
});