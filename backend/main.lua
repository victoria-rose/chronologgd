local logger     = require("logger")
local millennium = require("millennium")

require("rpc_functions")

local function on_load()
    logger:info("Backloggd Sync loaded with Millennium version " .. millennium.version())
    millennium.ready()
end

local function on_unload()
    logger:info("Backloggd Sync unloaded")
end

local function on_frontend_loaded()
    logger:info("Backloggd Sync frontend UI loaded")
end

return {
    on_load = on_load,
    on_unload = on_unload,
    on_frontend_loaded = on_frontend_loaded
}
