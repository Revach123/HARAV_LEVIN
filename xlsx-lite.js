/* xlsx-lite.js — יצירת קובץ Excel (.xlsx) אמיתי בדפדפן, כטבלת Excel (עם מסנני עמודות), מימין לשמאל.
 * בלי ספריות חיצוניות. שימוש:  downloadXlsx("שם-קובץ", "שם גיליון", ["כותרת1", ...], [[ערך, ...], ...], [true/false לכל עמודה: מספר?])
 */
(function () {
  const enc = new TextEncoder();
  const esc = s => String(s).replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

  const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

  // ZIP בלי דחיסה (store)
  function zip(files) {
    const chunks = [], central = []; let offset = 0;
    const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    for (const [name, text] of files) {
      const nm = enc.encode(name), data = enc.encode(text), crc = crc32(data);
      const local = new Uint8Array([0x50, 0x4B, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nm.length), ...u16(0)]);
      chunks.push(local, nm, data);
      central.push(new Uint8Array([0x50, 0x4B, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nm);
      offset += local.length + nm.length + data.length;
    }
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const end = new Uint8Array([0x50, 0x4B, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
    return new Blob([...chunks, ...central, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  const colName = i => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

  function makeXlsx(sheetName, headers, rows, numeric) {
    const sst = [], sstIdx = new Map();
    const si = s => { s = String(s); if (!sstIdx.has(s)) { sstIdx.set(s, sst.length); sst.push(s); } return sstIdx.get(s); };
    // כותרות ייחודיות (דרישת Excel לטבלה)
    const seen = new Map();
    const heads = headers.map(h => { let n = String(h || "עמודה") || "עמודה"; const k = seen.get(n) || 0; seen.set(n, k + 1); return k ? `${n} (${k + 1})` : n; });
    const nCols = heads.length, lastCol = colName(nCols - 1), nRows = rows.length + 1;
    const widths = heads.map((h, c) => { let w = h.length; for (const r of rows.slice(0, 300)) w = Math.max(w, String(r[c] ?? "").length); return Math.min(60, Math.max(8, w + 3)); });
    let sheetData = `<row r="1">${heads.map((h, c) => `<c r="${colName(c)}1" t="s"><v>${si(h)}</v></c>`).join("")}</row>`;
    rows.forEach((r, i) => {
      sheetData += `<row r="${i + 2}">` + heads.map((_, c) => {
        const v = r[c], ref = `${colName(c)}${i + 2}`;
        if (v === null || v === undefined || v === "") return "";
        if (numeric && numeric[c] && Number.isFinite(Number(v))) return `<c r="${ref}"><v>${Number(v)}</v></c>`;
        return `<c r="${ref}" t="s"><v>${si(v)}</v></c>`;
      }).join("") + `</row>`;
    });
    const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const sheetTitle = String(sheetName || "גיליון1").replace(/[\\\/\?\*\[\]:]/g, " ").slice(0, 31);
    return zip([
      ["[Content_Types].xml", X + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`],
      ["_rels/.rels", X + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ["xl/workbook.xml", X + `<workbook ${NS} xmlns:r="${REL}"><sheets><sheet name="${esc(sheetTitle)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
      ["xl/_rels/workbook.xml.rels", X + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId3" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
      ["xl/styles.xml", X + `<styleSheet ${NS}><fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
      ["xl/sharedStrings.xml", X + `<sst ${NS} count="${sst.length}" uniqueCount="${sst.length}">${sst.map(s => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`],
      ["xl/worksheets/sheet1.xml", X + `<worksheet ${NS} xmlns:r="${REL}"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${sheetData}</sheetData><tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>`],
      ["xl/worksheets/_rels/sheet1.xml.rels", X + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/table" Target="../tables/table1.xml"/></Relationships>`],
      ["xl/tables/table1.xml", X + `<table ${NS} id="1" name="Table1" displayName="Table1" ref="A1:${lastCol}${nRows}"><autoFilter ref="A1:${lastCol}${nRows}"/><tableColumns count="${nCols}">${heads.map((h, c) => `<tableColumn id="${c + 1}" name="${esc(h)}"/>`).join("")}</tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`],
    ]);
  }

  function downloadXlsx(fileName, sheetName, headers, rows, numeric) {
    const blob = makeXlsx(sheetName, headers, rows, numeric);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = fileName.replace(/\.xlsx$/i, "") + ".xlsx";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  window.makeXlsx = makeXlsx; window.downloadXlsx = downloadXlsx;
})();
