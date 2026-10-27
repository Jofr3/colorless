-- Fitting single-line text into a width: step the font size down, then cut
-- on UTF-8 boundaries and append '...'. Results are cached by their inputs.
local T=require('ui.theme')
local Codec=require('ui.codec')
local Fit={}
function Fit.chars(text) return tostring(text):gmatch(Codec.UTF8_CHAR) end
-- Byte ends of each character prefix (ends[k+1] for k characters), and the
-- most characters k for which `prefix..'...'` measures within width. Widths
-- grow with the prefix, so a binary search finds where they stop fitting.
local function longest(text,width,measure)
  local ends={0}
  for c in Fit.chars(text) do ends[#ends+1]=ends[#ends]+#c end
  local lo,hi=0,#ends-1
  while lo<hi do
    local mid=math.floor((lo+hi+1)/2)
    if measure(text:sub(1,ends[mid+1])..'...')<=width then lo=mid else hi=mid-1 end
  end
  return ends,lo
end
-- Longest prefix whose `prefix..'...'` measures within width, plus the ellipsis.
function Fit.ellipsize(text,width,measure)
  local ends,k=longest(text,width,measure)
  return text:sub(1,ends[k+1])..'...'
end
-- The builder caption's cut: one character past the longest fitting prefix.
function Fit.overhang(text,width,measure)
  if measure('...')>width then return '...' end
  local ends,k=longest(text,width,measure)
  k=math.min(#ends-1,k+1)
  return text:sub(1,ends[k+1])..'...'
end
function Fit.shrink(text,size,min,width)
  while size>min and T.font(size):getWidth(text)>width do size=size-1 end
  return size
end
-- compute(text,size,width) -> a,b,c, remembered per (text,size,width).
function Fit.cached(compute)
  local cache,count={},0
  return function(text,size,width)
    local bySize=cache[text]
    local byWidth=bySize and bySize[size]
    local hit=byWidth and byWidth[width]
    if hit then return hit[1],hit[2],hit[3] end
    if count>=512 then cache,count={},0;bySize=nil end
    if not bySize then bySize={};cache[text]=bySize end
    byWidth=bySize[size]
    if not byWidth then byWidth={};bySize[size]=byWidth end
    local a,b,c=compute(text,size,width)
    byWidth[width]={a,b,c};count=count+1
    return a,b,c
  end
end
-- Sizes step down to 14 before ellipsizing; returns the text and its size.
Fit.label=Fit.cached(function(text,size,width)
  size=Fit.shrink(text,size,14,width)
  local font=T.font(size)
  if font:getWidth(text)>width then text=Fit.ellipsize(text,width,function(s) return font:getWidth(s) end) end
  return text,size
end)
-- Control characters become spaces, then as Fit.label.
Fit.fit=Fit.cached(function(text,size,width)
  return Fit.label((text:gsub('%c',' ')),size,width)
end)
return Fit
