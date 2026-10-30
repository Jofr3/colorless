local Preferences={}
Preferences.__index=Preferences
-- The record is positional (serialize), so a new key is only ever appended.
Preferences.keys={'screenshake','reducedMotion','crt','bloom','volume','musicVolume','effectsVolume','muted','highFrameRate'}
-- highFrameRate: 0 caps update and draw at 60 per second, 1 allows 144 (main.lua frameCap).
Preferences.defaults={screenshake=50,reducedMotion=-1,crt=70,bloom=0,volume=50,musicVolume=100,effectsVolume=100,muted=0,highFrameRate=0}
local ranges={reducedMotion={-1,1},bloom={0,1},muted={0,1},highFrameRate={0,1}}
-- How many values a record had before highFrameRate was appended: such a record keeps its
-- settings, and the keys after them keep their defaults.
local FIRST_RECORD_LENGTH=8
function Preferences.new(raw)
  local self=setmetatable({},Preferences)
  for key,value in pairs(Preferences.defaults) do self[key]=value end
  -- A JSON record ({"screenshake":50,...}) reads field by field.
  if raw and raw:match('^%s*{') then
    for _,key in ipairs(Preferences.keys) do
      self:set(key,tonumber(raw:match('"'..key..'"%s*:%s*(-?[%d.]+)')))
    end
  elseif raw then
    local values={}
    for value in raw:gmatch('%S+') do values[#values+1]=tonumber(value) or false end
    if #values>=FIRST_RECORD_LENGTH and #values<=#Preferences.keys then
      for i=1,#values do self:set(Preferences.keys[i],values[i]) end
    end
  end
  return self
end
function Preferences:set(key,value)
  if Preferences.defaults[key]==nil or type(value)~='number' or value~=value or math.abs(value)==math.huge then return false end
  local range=ranges[key] or {0,100}
  value=math.max(range[1],math.min(range[2],math.floor(value+0.5)))
  if self[key]==value then return false end
  self[key]=value
  return true
end
function Preferences:reduced(system)
  return self.reducedMotion==1 or (self.reducedMotion==-1 and system)
end
function Preferences:serialize()
  local values={}
  for i,key in ipairs(Preferences.keys) do values[i]=tostring(self[key]) end
  return table.concat(values,' ')
end
return Preferences
