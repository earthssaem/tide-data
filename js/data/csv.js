// 최소 CSV 파서 (RFC 4180 따옴표 규칙, BOM, CRLF, '#' 주석 줄 지원)

export function parseCSV(text, { delimiter = ',', comment = '#' } = {}) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let atLineStart = true;
  let skipLine = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (skipLine) {
      if (c === '\n') { skipLine = false; atLineStart = true; }
      continue;
    }
    if (atLineStart && comment && c === comment && !inQuotes) { skipLine = true; continue; }
    atLineStart = false;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === delimiter) { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') {
      row.push(field); field = '';
      if (!(row.length === 1 && row[0] === '')) rows.push(row);
      row = []; atLineStart = true;
      continue;
    }
    field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
  }
  return rows;
}

/** 첫 줄을 머리글로 사용해 객체 배열로 변환 */
export function parseCSVObjects(text, opts) {
  const rows = parseCSV(text, opts);
  if (!rows.length) return { header: [], records: [] };
  const header = rows[0].map((h) => h.trim());
  const records = rows.slice(1).map((r, idx) => {
    const o = { __line: idx + 2 };
    header.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    return o;
  });
  return { header, records };
}
