// load-config.js
const fs = require("fs");
const yaml = require("js-yaml");
require("dotenv").config();

function loadConfig(path) {
  const raw = fs.readFileSync(path, "utf8");
  const interpolated = raw.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] || "");
  return yaml.load(interpolated);
}

module.exports = loadConfig;
