function love.conf(t)
  t.identity = 'colorless-lua'
  t.version = '11.4'
  t.window.title = 'Colorless'
  t.window.width, t.window.height = 1280, 800
  t.window.resizable = true
  t.window.vsync = 1
  t.modules.physics = false
  t.modules.video = false
end
