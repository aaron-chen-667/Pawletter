export const stations = [
  {id:'warm',name:'暖爪救助站',city:'杭州',lat:30.284,lng:120.168,area:'西湖周边'},
  {id:'garden',name:'小院猫咪之家',city:'杭州',lat:30.310,lng:120.128,area:'城西生活圈'},
  {id:'sun',name:'阳光小爪救助站',city:'上海',lat:31.230,lng:121.474,area:'市区周边'},
];
export const cityLocations = {
  '杭州':{label:'杭州',latitude:30.274,longitude:120.155},
  '上海':{label:'上海',latitude:31.224,longitude:121.475},
  '北京':{label:'北京',latitude:39.904,longitude:116.407},
};
export function distanceKm(a,b) {
  const rad=n=>n*Math.PI/180;
  const dLat=rad(b.lat-a.latitude),dLon=rad(b.lng-a.longitude);
  const h=Math.sin(dLat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export function stationFor(pet) {return stations.find(s=>s.id===pet.stationId)||stations.find(s=>s.name===pet.station)||stations[0];}
export function nearbyStations(location,radius) {
  return stations.map(station=>({...station,distance:distanceKm(location,station)})).filter(s=>s.distance<=radius).sort((a,b)=>a.distance-b.distance);
}
export function distanceLabel(km) { return km<1?'不到 1 km':`${km<10?km.toFixed(1):Math.round(km)} km`; }
export function initializeDiscovery(state) {
  state.location??={...cityLocations['杭州'],source:'demo'};
  state.discoveryMode??='nearby';state.radius??=20;state.passed??=[];state.swipeHistory??=[];
  for(const p of state.pets){
    if(!p.stationId){
      const id=p.id==='tabby'?'garden':p.id==='dog'?'sun':'warm';
      const station=stations.find(s=>s.id===id);p.stationId=id;p.station=station.name;p.city=station.city;
    }
  }
}
