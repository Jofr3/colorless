package.path='frontend/lua/?.lua;'..package.path
love={graphics={}}
local T=require('ui.theme')
for size=1,40 do T.fonts[size]={getWidth=function(_,s) return #s*size end} end
local Fit=require('ui.text_fit')
local text,size=Fit.fit('abc',20,100)
assert(text=='abc' and size==20)
text,size=Fit.fit('abcdef',20,100)
assert(text=='abcdef' and size==16)
text,size=Fit.fit('a\tbcdefghij',20,100)
assert(size==14 and text=='a bc...')
local chars={}
for c in Fit.chars('Zoë😀') do chars[#chars+1]=c end
assert(#chars==4 and chars[3]=='ë' and chars[4]=='😀')
assert(Fit.ellipsize('éabc',5,function(s) return #s end)=='é...')
assert(Fit.shrink('abcd',30,10,50)==12)
-- Cuts match a character-by-character scan for every width.
local function scan(text,width,measure,overhang)
  local out=''
  for c in Fit.chars(text) do
    if overhang then
      if measure(out..'...')>width then break end
    elseif measure(out..c..'...')>width then break end
    out=out..c
  end
  return out..'...'
end
local measure=function(s) local n=0;for c in Fit.chars(s) do n=n+(c=='W' and 3 or #c) end;return n end
for _,sample in ipairs({'','a','Wéa😀bcW dé','Very Long Card Name Number 8','ééééé'}) do
  for width=0,40 do
    assert(Fit.ellipsize(sample,width,measure)==scan(sample,width,measure,false),sample..' at '..width)
    assert(Fit.overhang(sample,width,measure)==scan(sample,width,measure,true),sample..' overhang at '..width)
  end
end
print('text_fit ok')
