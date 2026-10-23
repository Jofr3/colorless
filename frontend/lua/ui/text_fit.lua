-- Fitting single-line text into a width: step the font size down, then cut
-- on UTF-8 boundaries and append '...'.
local T=require('ui.theme')
local Codec=require('ui.codec')
local Fit={}
function Fit.chars(text) return tostring(text):gmatch(Codec.UTF8_CHAR) end
-- Longest prefix whose `prefix..'...'` measures within width, plus the ellipsis.
function Fit.ellipsize(text,width,measure)
  local out=''
  for c in Fit.chars(text) do
    if measure(out..c..'...')>width then break end
    out=out..c
  end
  return out..'...'
end
function Fit.shrink(text,size,min,width)
  while size>min and T.font(size):getWidth(text)>width do size=size-1 end
  return size
end
-- Control characters become spaces; sizes step down to 14 before ellipsizing.
function Fit.fit(text,size,width)
  text=text:gsub('%c',' ')
  size=Fit.shrink(text,size,14,width)
  local font=T.font(size)
  if font:getWidth(text)>width then text=Fit.ellipsize(text,width,function(s) return font:getWidth(s) end) end
  return text,size
end
return Fit
