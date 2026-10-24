-- Differential checks run Balatro's own source as the reference. That source
-- is not part of this repository, so a check that needs it is skipped (exit
-- 77) when it is missing, unless COLORLESS_REQUIRE_SOURCE is set.
local M={dir=os.getenv('BALATRO_SOURCE') or '../balatro-source'}

function M.available()
  local f=io.open(M.dir..'/engine/ui.lua')
  if f then f:close() end
  return f~=nil
end

local function missing()
  if os.getenv('COLORLESS_REQUIRE_SOURCE') then
    error('Balatro source not found at '..M.dir..'; set BALATRO_SOURCE')
  end
end

-- The source directory, or exit as skipped.
function M.required()
  if M.available() then return M.dir end
  missing()
  io.stderr:write('skipped: needs Balatro source at '..M.dir..'\n')
  os.exit(77)
end

-- The source directory, or nil when the caller should skip its source checks.
function M.optional()
  if M.available() then return M.dir end
  missing()
  return nil
end

return M
