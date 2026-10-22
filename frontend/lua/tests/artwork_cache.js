// Browser-native IndexedDB regression checks. With the Vite server running:
// agent-browser --session <name> eval --stdin < frontend/lua/tests/artwork_cache.js
(async () => {
  const { ArtworkCache } = await import('/src/lua/artworkCache.ts');
  const databases=[],connections=[];
  const assert=(ok,message)=>{if(!ok)throw Error(message)};
  const open=(name,budget)=>{const c=new ArtworkCache(name,budget);connections.push(c);return c};
  const name=label=>{const n=`colorless-artwork-test-${label}-${crypto.randomUUID()}`;databases.push(n);return n};
  const blob=(value,size=40)=>new Blob([value.padEnd(size,'.')],{type:'image/png'});
  try {
    const poolName=name('pool');let cache=open(poolName,100000);
    await Promise.all(Array.from({length:80},(_,i)=>cache.put(`card-${i}`,blob(`image-${i}`))));
    assert((await cache.get('card-0')).size===40,'Concurrent writes lost a card');
    const seen=new Set();let previous;
    for(let i=0;i<160;i++){
      if(i===20){await cache.close();cache=open(poolName,100000)}
      if(i===80)seen.clear();
      const picked=await cache.pick();
      assert(picked&&!seen.has(picked.id),'Repeated before all 80 persisted cards were shown');
      assert(picked.id!==previous,'Immediate repeat across shuffle cycles');
      assert((await picked.blob.text()).startsWith(picked.id.replace('card','image')),'Image did not survive reopen');
      seen.add(picked.id);previous=picked.id;await cache.markShown(picked.id);
    }
    await cache.put('new-card',blob('new'));
    assert((await cache.pick()).id==='new-card','New images must join an in-progress pool');
    await cache.remove('new-card');assert(await cache.get('new-card')===null,'Removal left artwork behind');
    // A prepared but unused card must not be recorded as shown.
    const one=open(name('one'),1000);await one.put('only',blob('only'));
    assert((await one.pick()).id==='only'&&(await one.pick()).id==='only','Preparing consumed a shuffle entry');
    await one.markShown('only');assert((await one.pick()).id==='only','One-card pool must remain usable');
    const lru=open(name('lru'),80);
    await lru.put('a',blob('a'));await new Promise(r=>setTimeout(r,5));
    await lru.put('b',blob('b'));await new Promise(r=>setTimeout(r,5));
    await lru.get('a');await lru.put('c',blob('c'));
    assert(await lru.get('b')===null&&await lru.get('a')&&await lru.get('c'),'Size eviction must preserve recently used artwork');
    assert(!await lru.put('huge',blob('huge',81)),'Oversized image exceeded budget');
    assert(await lru.get('a')&&await lru.get('c'),'Rejected image evicted useful cache entries');
    await lru.put('c',blob('replacement'));
    assert(await lru.get('a'),'Replacement counted the old bytes twice');
    const unavailable=new ArtworkCache('unused',1000,{open(){throw Error('Storage blocked')}});
    assert(!await unavailable.put('a',blob('a'))&&await unavailable.get('a')===null&&await unavailable.pick()===null,'Blocked storage must degrade without errors');
    return {pass:true,checks:'80-card persistence, reopen shuffle history, concurrent writes, new arrivals, selection acknowledgement, LRU size budget, replacement, blocked storage'};
  } finally {
    await Promise.all(connections.map(c=>c.close()));
    await Promise.all(databases.map(n=>new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(n);r.onsuccess=resolve;r.onerror=()=>reject(r.error)})));
  }
})()
