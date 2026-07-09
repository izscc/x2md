const test = require("node:test");
const assert = require("node:assert/strict");
const { X2MD_MESSAGES, x2mdT } = require("../i18n.js");

test("i18n messages provide zh-CN and en fallbacks", () => {
    assert.equal(X2MD_MESSAGES["zh-CN"].exportVisible, "导出可见");
    assert.equal(x2mdT("exportVisible", "en"), "Export visible");
    assert.equal(x2mdT("missing", "en"), "missing");
});
