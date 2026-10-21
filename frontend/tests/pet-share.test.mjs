import {test} from 'node:test';
import assert from 'node:assert/strict';
import {petShareData,sharePet} from '../dist/pet-share.js';
test('sharing uses only a public pet deep link and cancellation does not copy',async()=>{
 const data=petShareData({id:'pet-123',name:'汤圆'},'https://example.test/?flow=register&token=private#account');
 assert.equal(data.url,'https://example.test/?pet=pet-123');
 const sample=petShareData({id:'orange',name:'橘子'},'https://example.test/?examples=1&token=private');
 assert.equal(new URL(sample.url).searchParams.get('examples'),'1');assert.equal(new URL(sample.url).searchParams.has('token'),false);
 let copied=false;
 assert.equal(await sharePet(data,{share:async()=>{throw Object.assign(new Error(),{name:'AbortError'});},clipboard:{writeText:async()=>{copied=true;}}}),'cancelled');assert.equal(copied,false);
 assert.equal(await sharePet(data,{clipboard:{writeText:async url=>assert.equal(url,data.url)}}),'copied');
 assert.equal(await sharePet(data,{}),'manual');
});
