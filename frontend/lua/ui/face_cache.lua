-- Card faces kept after their cards go, keyed by what they show: a page turned to again, or one
-- drawn ahead of time, adopts its canvases instead of drawing them in the frame it opens. A face
-- a card holds is never released; past `limit`, the least recently used free ones are.
local Cache={}
Cache.__index=Cache
function Cache.new(limit) return setmetatable({entries={},count=0,tick=0,limit=limit},Cache) end
local function touch(self,entry) self.tick=self.tick+1;entry.used=self.tick end
function Cache:has(key) return self.entries[key]~=nil end
-- Marks a face as just used, so it outlives older free ones.
function Cache:touch(key)
  local entry=self.entries[key]
  if entry then touch(self,entry) end
end
-- The face for `key`, drawn by build() (a table with texture and resolution) when there is none.
-- The caller holds it until it passes it to release.
function Cache:acquire(key,build)
  local entry=self.entries[key]
  if not entry then
    entry=build();entry.key,entry.users=key,0
    self.entries[key]=entry;self.count=self.count+1
  end
  entry.users=entry.users+1;touch(self,entry)
  self:trim(self.limit)
  return entry
end
function Cache:release(entry)
  entry.users=entry.users-1
  self:trim(self.limit)
end
-- Releases the least recently used free faces until at most `limit` remain.
function Cache:trim(limit)
  while self.count>limit do
    local oldest
    for _,entry in pairs(self.entries) do
      if entry.users==0 and (not oldest or entry.used<oldest.used) then oldest=entry end
    end
    if not oldest then return end
    oldest.texture:release();self.entries[oldest.key]=nil;self.count=self.count-1
  end
end
return Cache
