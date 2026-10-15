-- Table juice: attention_text (UI_definitions.lua) with its particle backdrop,
-- a small blocking event sequencer (engine/event.lua's 'after' events), and
-- ease_background_colour's three-colour ramp for background.fs.
local T=require('ui.theme')
local Dyna=require('ui.dynatext')
local Fx={};Fx.__index=Fx
local g=love.graphics
local function mix(a,b,t) return {a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t,a[3]+(b[3]-a[3])*t,1} end
function Fx.new(callbacks)
  local self=setmetatable({callbacks=callbacks,texts={},queue={},time=0,ambient={}},Fx)
  self:background('setup',true)
  return self
end
-- Background palettes: ease_background_colour(new_colour, special, tertiary).
-- Your turn uses the Small Blind green; the opponent's turn the won/grey blue;
-- game over fades to the boss red or the win blue.
local palettes={
  setup={base={80/255,132/255,110/255,1},contrast=1},
  you={base={80/255,132/255,110/255,1},contrast=1},
  opponent={base={79/255,99/255,103/255,1},contrast=1},
  loss={base={180/255,68/255,48/255,1},contrast=2,special={55/255,66/255,68/255,1}},
  win={base={0,157/255,1,1},contrast=2,special={55/255,66/255,68/255,1}},
}
function Fx:background(kind,instant)
  local p=palettes[kind] or palettes.you
  local target={
    mix(p.base,p.base,1),
    p.special and p.special or {p.base[1]*0.9,p.base[2]*0.9,p.base[3]*0.9,1},
    {p.base[1]*(p.special and 0.4 or 0.7),p.base[2]*(p.special and 0.4 or 0.7),p.base[3]*(p.special and 0.4 or 0.7),1},
    contrast=p.contrast,
  }
  target[1]={p.base[1]*1.3,p.base[2]*1.3,p.base[3]*1.3,1}
  self.bgTarget=target
  if instant or not self.bg then self.bg={mix(target[1],target[1],1),mix(target[2],target[2],1),mix(target[3],target[3],1),contrast=target.contrast} end
  self.bgKind=kind
end
function Fx:colours() return self.bg end
-- Blocking sequencer: each entry waits `delay` seconds after the previous one
-- finished, then runs. Non-blocking decorations call `fn` immediately.
function Fx:after(delay,fn) self.queue[#self.queue+1]={delay=delay,fn=fn} end
function Fx:clear() self.queue={};self.texts={} end
-- attention_text: DynaText (pop_in 0, rate 6, pulse 0.5, float, shadow) over a
-- single Particles square that grows while the text holds, then fades out.
function Fx:attention(args)
  local text=Dyna.new({string=args.text,scale=args.scale or 1,colours={args.colour or T.white},float=true,shadow=true,pop_in=0,pop_in_rate=6,time=self.time,maxw=args.maxw})
  text:pulse(0.5,self.time)
  local at={text=text,x=args.x,y=args.y,hold=(args.hold or 0)+0.1,start=self.time,backdrop=args.backdrop,rotation=(love.math.random()*2-1)*0.35,fade=1,offsetY=args.offsetY or 0,major=args.major,follow=args.follow}
  self.texts[#self.texts+1]=at
  if args.sound then self.callbacks.feedback(args.sound,args.pitch) end
  if args.jiggle then self.callbacks.jiggle(args.jiggle) end
  return at
end
function Fx:update(dt,time,reduced,paused)
  self.time=time
  -- Sequencer.
  local q=(not paused) and self.queue[1]
  if q then
    q.wait=(q.wait or 0)+dt
    if q.wait>=q.delay then table.remove(self.queue,1);q.fn() end
  end
  -- Attention texts.
  for i=#self.texts,1,-1 do
    local at=self.texts[i]
    at.text:update(time,reduced)
    local age=time-at.start
    if age>at.hold then
      if not at.fadeStart then at.fadeStart=time;at.text:pop_out(3,time) end
      at.fade=math.max(0,1-3*(time-at.fadeStart))
      if at.fade<=0 then table.remove(self.texts,i) end
    end
  end
  -- Background easing (ease_value over ~0.6s).
  if self.bg and self.bgTarget then
    local k=math.min(1,dt/0.6*1.6)
    for c=1,3 do for ch=1,3 do self.bg[c][ch]=self.bg[c][ch]+(self.bgTarget[c][ch]-self.bg[c][ch])*k end end
    self.bg.contrast=self.bg.contrast+(self.bgTarget.contrast-self.bg.contrast)*k
  end
end
function Fx:draw(roomWidth)
  for _,at in ipairs(self.texts) do
    local x,y
    if at.follow then x,y=at.follow() else x,y=at.x,at.y end
    y=y+at.offsetY
    local age=self.time-at.start
    if at.backdrop then
      -- Particles{scale=2.4, lifespan=5, speed=0}: one square growing from the centre.
      local size=math.min(2*(age/5)*2.4,2.4)*60*(at.text.scale or 1)*0.7
      local c=at.backdrop
      g.push();g.translate(x,y);g.rotate(at.rotation+age*0.1)
      g.setColor(c[1],c[2],c[3],(c[4] or 1)*at.fade)
      g.rectangle('fill',-size/2,-size/2,size,size)
      g.pop()
    end
    at.text:draw(x,y,roomWidth,at.fade)
  end
end
return Fx
