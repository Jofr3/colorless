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
print('text_fit ok')
