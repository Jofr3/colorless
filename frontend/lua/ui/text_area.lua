-- A multi-line text field: the builder's decklist. Each paragraph wraps to the field on its own;
-- the field scrolls 25 px a line from `view.scroll` and follows the caret while it is edited,
-- drawing the selection and a blinking caret. The host's text proxy owns the editing itself.
local T=require('ui.theme')
local Codec=require('ui.codec')
local Input=require('ui.text_input')
local g=love.graphics
local TextArea={}
TextArea.__index=TextArea
local SIZE,LINE=22,25
function TextArea.new(placeholder)
  return setmetatable({placeholder=placeholder},TextArea)
end
-- The lines `text` wraps to at `width`, each with the byte span it covers in `text`. A decklist
-- can run to the 30000-character cap, so the wrap is kept until the text, width or font changes.
function TextArea:wrap(font,text,width)
  if self.wrapText==text and self.wrapWidth==width and self.wrapFont==font then return self.wrapped end
  local lines={};local base=0
  for paragraph in (text..'\n'):gmatch('(.-)\n')do
    local _,wrapped=font:getWrap(paragraph,width);if #wrapped==0 then wrapped={''}end
    local cursor=1
    for _,line in ipairs(wrapped)do
      local at=paragraph:find(line,cursor,true) or cursor
      lines[#lines+1]={text=line,first=base+at-1,last=base+at-1+#line};cursor=at+#line
    end
    base=base+#paragraph+1
  end
  self.wrapText,self.wrapWidth,self.wrapFont,self.wrapped=text,width,font,lines
  return lines
end
-- Draws the field `b` holding `value`. `active`: the page takes input (no dialog over it);
-- `editing`: the proxy edits this field, with the selection from UTF-16 offsets `first` to
-- `last`; `lit`: the field's hover look; `view` holds the scroll.
function TextArea:draw(b,value,active,editing,first,last,time,lit,view)
  Input.background(b,active and editing,b.disabled,lit)
  local font=T.font(SIZE)
  local display=value~='' and value or self.placeholder
  local lines=self:wrap(font,display,b.w-24)
  first=#Codec.utf16Prefix(value,first or 0);last=#Codec.utf16Prefix(value,last or 0)
  local caretLine=1
  for i,line in ipairs(lines)do if last>=line.first then caretLine=i end end
  local visible=math.floor((b.h-20)/LINE)
  local start=math.max(1,math.min(math.max(1,#lines-visible+1),math.floor((view.scroll or 0)/LINE)+1))
  if editing and (self.caretByte~=last or self.caretValue~=value)then
    if caretLine<start then start=caretLine elseif caretLine>=start+visible then start=caretLine-visible+1 end
    view.scroll=(start-1)*LINE;self.caretByte,self.caretValue=last,value
  end
  for n=start,math.min(#lines,start+visible-1)do
    local line=lines[n];local ly=b.y+10+(n-start)*LINE
    if editing and last>first and first<=line.last and last>=line.first then
      local left=font:getWidth(line.text:sub(1,math.max(0,first-line.first)))
      local right=font:getWidth(line.text:sub(1,math.min(#line.text,last-line.first)))
      g.setColor(T.blue);g.rectangle('fill',b.x+12+left,ly,math.max(2,right-left),LINE)
    end
    T.text(line.text,SIZE,b.x+12,ly,b.w-24,T.paper,'left')
    if editing and n==caretLine and math.floor(time*2)%2==0 then
      local px=font:getWidth(line.text:sub(1,math.max(0,last-line.first)))
      g.setColor(T.white);g.rectangle('fill',b.x+12+px,ly,2,SIZE)
    end
  end
end
return TextArea
