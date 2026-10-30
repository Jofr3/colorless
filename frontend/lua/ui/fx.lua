-- attention_text (UI_definitions.lua) with its particle backdrop, and a small
-- blocking event sequencer (engine/event.lua's 'after' events).
local T=require('ui.theme')
local Dyna=require('ui.dynatext')
local Fx={};Fx.__index=Fx
local g=love.graphics
function Fx.new(callbacks)
  return setmetatable({callbacks=callbacks,texts={},queue={},time=0},Fx)
end
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
  self.time,self.reduced=time,reduced
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
end
function Fx:draw(roomWidth)
  for _,at in ipairs(self.texts) do
    local x,y
    if at.follow then x,y=at.follow() else x,y=at.x,at.y end
    y=y+at.offsetY
    local age=self.time-at.start
    if at.backdrop then
      -- Particles{scale=2.4, lifespan=5, speed=0}: one square growing from the centre.
      -- Under reduced motion it holds the size and tilt it reaches with motion on as the
      -- text's hold ends, the largest pose motion-on players see, and neither grows nor spins.
      local pose=self.reduced and at.hold or age
      local size=math.min(2*(pose/5)*2.4,2.4)*60*(at.text.scale or 1)*0.7
      local c=at.backdrop
      g.push();g.translate(x,y);g.rotate(at.rotation+pose*0.1)
      g.setColor(c[1],c[2],c[3],(c[4] or 1)*at.fade)
      g.rectangle('fill',-size/2,-size/2,size,size)
      g.pop()
    end
    at.text:draw(x,y,roomWidth,at.fade)
  end
end
return Fx
