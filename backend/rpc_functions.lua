local http       = require("http")
local logger     = require("logger")
local millennium = require("millennium")

local json_ok, json = pcall(require, "json")
if not json_ok or not json then
    json_ok, json = pcall(require, "cjson")
end

local function safe_json_encode(tbl)
    if json and json.encode then
        local ok, res = pcall(json.encode, tbl)
        if ok then return res end
    end
    local status = tostring(tbl.status or 0)
    local body = tbl.body or ""
    local err = tbl.error and ('"error":' .. string.format("%q", tbl.error) .. ',') or ""
    local escaped_body = string.format("%q", body)
    return '{"status":' .. status .. ',' .. err .. '"body":' .. escaped_body .. ',"headers":{}}'
end

local function safe_json_decode(str)
    if json and json.decode then
        local ok, res = pcall(json.decode, str)
        if ok and type(res) == "table" then return res end
    end
    return {}
end

---@ffi
--- Proxy an HTTP request with arbitrary headers (including Cookie) via Millennium curl.
--- Headers are passed as a JSON string to ensure full compatibility with FFI marshalling.
--- Returns response as a JSON string.
---@param url string
---@param method string
---@param headersJson string|nil
---@param body string|nil
---@return string
function httpRequest(url, method, headersJson, body)
    local headers = {}
    if headersJson and headersJson ~= "" then
        headers = safe_json_decode(headersJson)
    end

    local options = {
        method = method or "GET",
        headers = headers,
        data = body,
        timeout = 20
    }

    logger:info("Proxying " .. (method or "GET") .. " " .. url)
    local call_ok, res, err = pcall(http.request, url, options)
    if not call_ok then
        logger:error("http.request threw error: " .. tostring(res))
        return safe_json_encode({
            status = 0,
            body = "",
            error = tostring(res or "HTTP request threw error")
        })
    end
    if not res then
        logger:error("Backend HTTP request failed: " .. tostring(err))
        return safe_json_encode({
            status = 0,
            body = "",
            error = tostring(err or "HTTP request failed")
        })
    end

    local responseObj = {
        status = res.status,
        body = res.body or "",
        headers = res.headers or {}
    }
    return safe_json_encode(responseObj)
end

---@ffi
--- Returns plugin version
---@return string
function getPluginVersion()
    return "1.0.0"
end

---@ffi
--- Returns plugin icon SVG
---@return string
function getPluginIcon()
    return millennium.assets.read("resources/icon.svg")
end

logger:info("Registered Backloggd Sync RPC Functions")
