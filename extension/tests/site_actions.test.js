const test = require("node:test");
const assert = require("node:assert/strict");

const {
    detectFloatingSaveSite,
    isFloatingSaveIconEnabled,
} = require("../site_actions.js");

test("detectFloatingSaveSite recognizes supported site pages only", () => {
    assert.equal(detectFloatingSaveSite({ hostname: "linux.do", pathname: "/t/topic/841319" }), "linux_do");
    assert.equal(detectFloatingSaveSite({ hostname: "waytoagi.feishu.cn", pathname: "/wiki/QPe5w5g7UisbEkkow8XcDmOpn8e" }), "feishu");
    assert.equal(detectFloatingSaveSite({ hostname: "waytoagi.feishu.cn", pathname: "/docx/G9fzdabOlocE16x80BXcFXtUnu8" }), "feishu");
    assert.equal(detectFloatingSaveSite({ hostname: "x.com", pathname: "/foo/status/1" }), null);
});

test("isFloatingSaveIconEnabled defaults to true and respects config", () => {
    assert.equal(isFloatingSaveIconEnabled({}), true);
    assert.equal(isFloatingSaveIconEnabled({ show_site_save_icon: true }), true);
    assert.equal(isFloatingSaveIconEnabled({ show_site_save_icon: false }), false);
});
