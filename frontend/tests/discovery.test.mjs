import test from 'node:test';
import assert from 'node:assert/strict';
import {freshState} from '../dist/domain.js';
import {initializeDiscovery,cityLocations,nearbyStations,distanceKm,stations} from '../dist/discovery.js';
test('距离计算与附近过滤使用用户位置',()=>{
  assert.equal(distanceKm({latitude:30,longitude:120},{lat:30,lng:120}),0);
  assert.equal(nearbyStations(cityLocations['杭州'],20).length,2);
  assert.equal(nearbyStations(cityLocations['上海'],20)[0].id,'sun');
  assert.equal(nearbyStations(cityLocations['北京'],20).length,0);
  assert.ok(distanceKm(cityLocations['杭州'],stations[2])>100);
});
test('发现页迁移不覆盖已有领养与偏好状态',()=>{
  const s=freshState();s.pets[0].status='adopted';s.following=['orange'];
  initializeDiscovery(s);assert.equal(s.pets[0].status,'adopted');assert.deepEqual(s.following,['orange']);
  assert.equal(s.pets.find(p=>p.id==='dog').city,'上海');
  s.location={...cityLocations['北京'],source:'manual'};initializeDiscovery(s);
  assert.equal(s.location.label,'北京');
});
