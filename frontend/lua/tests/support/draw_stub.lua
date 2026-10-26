-- A headless LÖVE graphics stub that counts calls and tracks every Canvas and
-- Image it hands out, so tests can bound per-frame work and catch leaked,
-- double-released or released-then-drawn textures.
local Stub={counts={},live={canvas=0,image=0,art=0},generation=0}
local counts,live=Stub.counts,Stub.live
local function count(name) counts[name]=(counts[name] or 0)+1 end
function Stub.reset() for k in pairs(counts) do counts[k]=nil end end
function Stub.get(name) return counts[name] or 0 end

local function texture(kind,w,h,art)
  live[kind]=live[kind]+1
  if art then live.art=live.art+1 end
  Stub.generation=Stub.generation+1
  local t={kind=kind,generation=Stub.generation}
  function t.release(self)
    assert(not self.released,kind..' released twice')
    self.released=true;live[kind]=live[kind]-1;count(kind..'.release')
    if art then live.art=live.art-1 end
    return true
  end
  function t.setFilter() end
  function t.setWrap() end
  function t.getWidth() return w end
  function t.getHeight() return h end
  function t.getDimensions() return w,h end
  return t
end
local function usable(t,what)
  if type(t)=='table' and t.released then error(what..' a released '..t.kind,3) end
end

local function font()
  return {getWidth=function(_,s) count('font.getWidth');return #tostring(s)*8 end,getHeight=function() return 20 end,
    getWrap=function(_,s,w) count('font.getWrap');local lines={};local line=''
      for word in tostring(s):gmatch('%S+') do
        if #line+#word+1>w/8 and line~='' then lines[#lines+1]=line;line=word else line=line=='' and word or line..' '..word end
      end
      if line~='' then lines[#lines+1]=line end;return #s*8,lines end,
    setFilter=function() end}
end
Stub.font=font

local imageData={}
imageData.__index=imageData
function imageData:getDimensions() return self.w,self.h end
function imageData:getPixel() count('imageData.getPixel');return 0.5,0.5,0.5,1 end
function imageData:release() count('imageData.release') end

local g=setmetatable({
  transformPoint=function(x,y) return x,y end,
  newImage=function(source)
    count('g.newImage')
    if type(source)=='string' then count('decode') end
    local art=type(source)=='string' and source:match('^__card_art') or type(source)=='table' and source.art
    return texture('image',272,374,art)
  end,
  newCanvas=function(w,h) count('g.newCanvas');return texture('canvas',w,h) end,
  newQuad=function() return {} end,
  newFont=function() return font() end,
  newMesh=function() count('g.newMesh');return texture('mesh',0,0) end,
  newSpriteBatch=function() count('g.newSpriteBatch');return texture('batch',0,0) end,
  setCanvas=function(c) count('g.setCanvas');usable(c,'set') end,
  draw=function(t) count('g.draw');usable(t,'drew') end,
  getBlendMode=function() return 'alpha','alphamultiply' end,
  getScissor=function() return nil end,
  getDimensions=function() return 1280,800 end,
},{__index=function(t,k)
  local name='g.'..k
  local f=function() count(name) end
  rawset(t,k,f)
  return f
end})
live.mesh,live.batch=0,0
Stub.graphics=g

function Stub.shader()
  return {hasUniform=function() count('shader.hasUniform');return true end,send=function() count('shader.send') end}
end

-- Installs the stub as the global `love`; paths starting with __card_art exist
-- and count towards live.art while decoded.
function Stub.install()
  love={math={random=function() return 0.5 end},graphics=g,keyboard={isDown=function() return false end},
    image={newImageData=function(path)
      count('image.newImageData');if type(path)=='string' then count('decode') end
      return setmetatable({w=272,h=374,art=type(path)=='string' and path:match('^__card_art')~=nil},imageData)
    end},
    filesystem={getInfo=function(p) return tostring(p):match('^__card_art') and {type='file'} or nil end,read=function() return nil end},
    mouse={getPosition=function() return 0,0 end},
    data={},timer={getTime=function() return 0 end}}
  local T=require('ui.theme')
  local shared=font()
  T.font=function() return shared end
  return Stub
end
return Stub
