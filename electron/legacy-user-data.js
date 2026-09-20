"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Electron derives the `userData` directory from the product name, so a renamed
 * app starts with an empty one — silently losing drafts, window geometry and
 * layout state. Pick the newest legacy directory that still exists; when the
 * current one is already there the migration has run and there is nothing to do.
 *
 * @param {string} support      Electron's `appData` directory
 * @param {string} appName      current product name
 * @param {string[]} legacyNames previous product names, newest first
 * @returns {string | null} directory to copy from, or null to skip
 */
function legacyUserDataSource(support, appName, legacyNames) {
  if (fs.existsSync(path.join(support, appName))) return null;
  return (
    legacyNames
      .map((name) => path.join(support, name))
      .find((dir) => fs.existsSync(dir)) ?? null
  );
}

module.exports = { legacyUserDataSource };
