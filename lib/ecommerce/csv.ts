/**
 * 轻量 CSV 解析器（无需额外依赖）。
 * 支持：双引号包裹、逗号分隔、引号内转义（""）、CRLF/LF。
 */

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const len = input.length;

  for (let i = 0; i < len; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (ch === '\r') {
        // 忽略 \r（配合 \n 处理换行）
      } else {
        field += ch;
      }
    }
  }

  // 处理最后一行（无结尾换行）
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // 去除末尾空行
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === '')) {
    rows.pop();
  }

  return rows;
}

/**
 * 将 CSV 文本解析为对象数组，第一行为表头。
 */
export function csvToObjects(input: string): Record<string, string>[] {
  const rows = parseCsv(input);
  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  const objects: Record<string, string>[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const obj: Record<string, string> = {};
    headers.forEach((header, idx) => {
      obj[header] = (row[idx] ?? '').trim();
    });
    objects.push(obj);
  }

  return objects;
}

/**
 * 生成商品导入模板 CSV 内容。
 */
export function productTemplateCsv(): string {
  const header = ['title', 'description', 'category', 'price', 'sku', 'color', 'size', 'material'];
  const sample = [
    ['示例商品标题', '这是商品的描述', '服装', '199.00', 'SKU-001', '红色', 'M', '纯棉'],
  ];
  const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return [header, ...sample]
    .map((row) => row.map(escape).join(','))
    .join('\n');
}
