(function (globalScope) {
    function getTagName(element) {
        return String(element?.tagName || "").toLowerCase();
    }

    function getClassList(element) {
        return String(element?.className || "").split(/\s+/).filter(Boolean);
    }

    function safeGetAttribute(element, name) {
        try {
            if (element && typeof element.getAttribute === "function") {
                return element.getAttribute(name);
            }
        } catch (error) { }
        return null;
    }

    function safeClosest(element, selector) {
        try {
            if (element && typeof element.closest === "function") {
                return element.closest(selector);
            }
        } catch (error) { }
        return null;
    }

    function getNodeText(node) {
        if (!node) return "";
        if (node.nodeType === 3) return node.textContent || "";
        if (node.nodeType !== 1) return "";
        return node.innerText || node.textContent || "";
    }

    function cleanZeroWidth(text) {
        return String(text || "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
    }

    /**
     * 转义 Markdown 链接文本中的特殊字符 [ 和 ]
     */
    function escapeMdLinkText(text) {
        return String(text || "").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
    }

    /**
     * 转义 Markdown 链接 URL 中的括号
     */
    function escapeMdLinkUrl(url) {
        return String(url || "").replace(/\(/g, "%28").replace(/\)/g, "%29");
    }

    /**
     * 将 HTML <table> 节点转换为 GFM pipe table markdown
     * @param {Element} tableNode - <table> DOM 节点
     * @param {Function} cellConverter - 将单元格节点转为 markdown 文本的函数 (cell, options) => string
     * @param {Object} options - 传递给 cellConverter 的选项
     * @returns {string} GFM markdown table 字符串
     */
    function convertTableToGfm(tableNode, cellConverter, options) {
        // 处理 colspan/rowspan：GFM 不支持合并单元格，展开为重复列/行
        const trList = tableNode.querySelectorAll?.("tr") || [];
        // 先构建一个二维网格，处理 rowspan 占位
        const grid = [];
        const rowspanTracker = []; // rowspanTracker[col] = { text, remaining }
        for (const tr of trList) {
            const row = [];
            let colIdx = 0;
            const cellList = tr.querySelectorAll?.("td, th") || [];
            let cellPos = 0;
            while (cellPos < cellList.length || (rowspanTracker[colIdx] && rowspanTracker[colIdx].remaining > 0)) {
                // 先填充 rowspan 占位
                if (rowspanTracker[colIdx] && rowspanTracker[colIdx].remaining > 0) {
                    row.push(rowspanTracker[colIdx].text);
                    rowspanTracker[colIdx].remaining--;
                    colIdx++;
                    continue;
                }
                if (cellPos >= cellList.length) break;
                const cell = cellList[cellPos];
                const text = cellConverter(cell, options)
                    .replace(/\n/g, " ")
                    .replace(/\|/g, "\\|")
                    .trim();
                const colspan = Math.max(1, parseInt(cell.getAttribute("colspan")) || 1);
                const rowspan = Math.max(1, parseInt(cell.getAttribute("rowspan")) || 1);
                for (let c = 0; c < colspan; c++) {
                    row.push(text);
                    if (rowspan > 1) {
                        rowspanTracker[colIdx] = { text, remaining: rowspan - 1 };
                    }
                    colIdx++;
                }
                cellPos++;
            }
            if (row.length) grid.push(row);
        }
        if (!grid.length) return "";
        const colCount = Math.max(...grid.map(r => r.length));
        const lines = [];
        grid.forEach((row, i) => {
            while (row.length < colCount) row.push("");
            lines.push("| " + row.join(" | ") + " |");
            if (i === 0) lines.push("| " + Array(colCount).fill("---").join(" | ") + " |");
        });
        return "\n" + lines.join("\n") + "\n";
    }

    /**
     * 将 GFM pipe table 转换为 HTML <table> 字符串
     * @param {string} gfmTable - GFM markdown table 字符串
     * @returns {string} HTML table 字符串
     */
    function convertGfmTableToHtml(gfmTable) {
        const lines = gfmTable.trim().split("\n").filter(l => l.trim().startsWith("|"));
        if (lines.length < 2) return "";
        const parseRow = (line) => line.split("|").slice(1, -1).map(c => c.replace(/\\\|/g, "|").trim());
        const headers = parseRow(lines[0]);
        // lines[1] is separator, skip it
        const bodyRows = lines.slice(2).map(parseRow);
        let html = "<table>\n<thead>\n<tr>\n";
        headers.forEach(h => { html += `  <th>${h}</th>\n`; });
        html += "</tr>\n</thead>\n<tbody>\n";
        bodyRows.forEach(row => {
            html += "<tr>\n";
            row.forEach(cell => { html += `  <td>${cell}</td>\n`; });
            html += "</tr>\n";
        });
        html += "</tbody>\n</table>";
        return html;
    }

    /**
     * 将 GFM 表格同时输出为 Markdown + HTML 双格式
     * @param {string} gfmTable - GFM markdown table 字符串
     * @param {boolean} includeHtml - 是否同时输出 HTML 版本
     * @returns {string} Markdown table，可选附带 HTML 版本
     */
    function renderTableDualFormat(gfmTable, includeHtml) {
        if (!gfmTable || !gfmTable.trim()) return "";
        if (!includeHtml) return gfmTable;
        const htmlTable = convertGfmTableToHtml(gfmTable);
        return gfmTable + "\n\n" + htmlTable;
    }

    const exported = {
        cleanZeroWidth,
        convertGfmTableToHtml,
        convertTableToGfm,
        escapeMdLinkText,
        escapeMdLinkUrl,
        getClassList,
        getNodeText,
        getTagName,
        renderTableDualFormat,
        safeClosest,
        safeGetAttribute,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = exported;
    }

    // 命名空间挂载，避免全局污染；同时保持向后兼容（直接访问函数名）
    globalScope.X2MD = Object.assign(globalScope.X2MD || {}, exported);
    Object.assign(globalScope, exported);
})(typeof globalThis !== "undefined" ? globalThis : this);
