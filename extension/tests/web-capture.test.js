const test = require('node:test');
const assert = require('node:assert/strict');

require('../dom_utils.js');
const discourse = require('../discourse.js');
const feishu = require('../feishu.js');
const wechat = require('../wechat.js');
const web = require('../site-adapters/web-capture.js');

function legacy(platform, url) {
    return {
        type: 'article', url, author: '作者', handle: '@author', author_url: `${url}/author`,
        published: '2026-07-10T00:00:00.000Z', article_title: `${platform} 标题`,
        article_content: '# 正文\n\n```js\nconst ok = true;\n```', images: ['https://cdn.example/image.png'], videos: [], platform,
    };
}

test('三种 web adapter 都输出 CaptureDocumentV1，且 wrapper 统一规范化', async () => {
    const cases = [
        ['linux_do', discourse.linuxDoCaptureAdapter, 'linuxdo', 'https://linux.do/t/topic/1/2'],
        ['feishu', feishu.feishuCaptureAdapter, 'feishu', 'https://acme.feishu.cn/docx/token'],
        ['wechat', wechat.wechatCaptureAdapter, 'wechat', 'https://mp.weixin.qq.com/s/token'],
    ];
    for (const [siteKey, adapter, platform, url] of cases) {
        assert.equal(typeof adapter.capture, 'function');
        const document = web.captureLegacyWebDocument(legacy(adapter === feishu.feishuCaptureAdapter ? 'Feishu' : adapter === wechat.wechatCaptureAdapter ? 'WeChat' : 'LINUX DO', url), { capturedAt: '2026-07-11T00:00:00.000Z' });
        const normalized = await web.webCaptureAdapter.capture(siteKey, { adapter: { capture: async () => document } });
        assert.equal(normalized.schema_version, 1);
        assert.equal(normalized.source.platform, platform);
        assert.equal(normalized.content.type, 'web-article');
        assert.match(normalized.content.markdown, /```js/);
        assert.deepEqual(normalized.media, [{ kind: 'image', url: 'https://cdn.example/image.png' }]);
        assert.deepEqual(web.webCaptureAdapter.normalize(normalized), legacy(adapter === feishu.feishuCaptureAdapter ? 'Feishu' : adapter === wechat.wechatCaptureAdapter ? 'WeChat' : 'LINUX DO', url));
    }
});

test('wrapper 拒绝未知站点并保持 CaptureDocumentV1 作为唯一输出', async () => {
    await assert.rejects(() => web.webCaptureAdapter.capture('unknown', {}), /unsupported web capture site/);
});

test('飞书滚动收集属于飞书 adapter 并按 block id 排序后恢复位置', async () => {
    const blocks = [{ getAttribute: () => '20', cloneNode: () => ({ id: '20' }) }, { getAttribute: () => '3', cloneNode: () => ({ id: '3' }) }];
    const container = { scrollTop: 17, clientHeight: 500, scrollHeight: 0 };
    const doc = { querySelector: (s) => s === '.bear-web-x-container' ? container : null, querySelectorAll: () => blocks };
    const result = await feishu.scrollAndCollectFeishuBlocks(doc, { wait: async () => {} });
    assert.deepEqual(result.map((block) => block.id), ['3', '20']);
    assert.equal(container.scrollTop, 17);
});
