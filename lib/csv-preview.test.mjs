// fork:zc-12 — CSV / TSV 解析纯函数测试。
// 覆盖：引号转义、引号内换行、CRLF、行宽不齐、分隔符嗅探、行 / 列截断标记。
import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./csv-preview.ts");
}

test("parses a plain comma table into header and rows", async () => {
  const { parseDelimitedText } = await loadSubject();
  const parsed = parseDelimitedText("name,qty\napple,3\nbanana,5\n");
  assert.equal(parsed.delimiter, ",");
  assert.deepEqual(parsed.header, ["name", "qty"]);
  assert.deepEqual(parsed.rows, [["apple", "3"], ["banana", "5"]]);
  assert.equal(parsed.rowCount, 2);
  assert.equal(parsed.columnCount, 2);
  assert.equal(parsed.truncated, false);
  assert.equal(parsed.ragged, false);
});

test("unescapes doubled quotes and keeps quoted delimiters", async () => {
  const { parseDelimitedText } = await loadSubject();
  const parsed = parseDelimitedText('quote,note\n"say ""hi""","a,b"\n');
  assert.deepEqual(parsed.rows, [['say "hi"', "a,b"]]);
});

test("keeps newlines that are embedded inside quoted fields", async () => {
  const { parseDelimitedText } = await loadSubject();
  const parsed = parseDelimitedText('id,text\r\n1,"line one\r\nline two"\r\n2,plain\r\n');
  assert.deepEqual(parsed.rows, [["1", "line one\nline two"], ["2", "plain"]]);
  assert.equal(parsed.ragged, false);
});

test("handles CRLF, LF and bare CR line endings", async () => {
  const { parseDelimitedText } = await loadSubject();
  assert.deepEqual(parseDelimitedText("a,b\r\n1,2\r\n").rows, [["1", "2"]]);
  assert.deepEqual(parseDelimitedText("a,b\n1,2\n").rows, [["1", "2"]]);
  assert.deepEqual(parseDelimitedText("a,b\r1,2\r").rows, [["1", "2"]]);
  // A trailing newline must not produce a phantom empty row.
  assert.equal(parseDelimitedText("a,b\n1,2\n").rowCount, 1);
});

test("reports ragged rows without dropping them", async () => {
  const { parseDelimitedText } = await loadSubject();
  const parsed = parseDelimitedText("a,b,c\n1,2,3\n4,5\n6,7,8,9\n");
  assert.equal(parsed.ragged, true);
  assert.equal(parsed.raggedRows, 2);
  assert.deepEqual(parsed.rows, [["1", "2", "3"], ["4", "5"], ["6", "7", "8", "9"]]);
});

test("sniffs tabs when commas are only field content", async () => {
  const { sniffDelimiter } = await loadSubject();
  assert.equal(sniffDelimiter("name\tnote\napple\tred, sweet\nbanana\tyellow\n"), "\t");
  assert.equal(sniffDelimiter("name,note\napple,red\nbanana,yellow\n"), ",");
  // Single-column content has no candidate delimiter: default comma.
  assert.equal(sniffDelimiter("name\napple\n"), ",");
});

test("honours an explicit delimiter and preserves CJK plus BOM", async () => {
  const { parseDelimitedText } = await loadSubject();
  const parsed = parseDelimitedText("\ufeff名称;数量\n苹果;3\n", { delimiter: "," });
  assert.deepEqual(parsed.header, ["名称;数量"]);
  assert.deepEqual(parsed.rows, [["苹果;3"]]);

  const csv = parseDelimitedText("名称\t备注\n苹果\t红, 甜\n");
  assert.equal(csv.delimiter, "\t");
  assert.deepEqual(csv.rows, [["苹果", "红, 甜"]]);
});

test("flags row truncation and keeps only maxRows data rows", async () => {
  const { parseDelimitedText } = await loadSubject();
  const parsed = parseDelimitedText("a\n1\n2\n3\n4\n", { maxRows: 2 });
  assert.equal(parsed.rowsTruncated, true);
  assert.equal(parsed.truncated, true);
  assert.deepEqual(parsed.rows, [["1"], ["2"]]);
  assert.equal(parsed.rowCount, 2);

  // Exactly maxRows rows is not truncation.
  const exact = parseDelimitedText("a\n1\n2\n", { maxRows: 2 });
  assert.equal(exact.rowsTruncated, false);
  assert.equal(exact.truncated, false);
});

test("flags column truncation and drops the extra fields", async () => {
  const { parseDelimitedText } = await loadSubject();
  const parsed = parseDelimitedText("a,b,c\n1,2,3\n", { maxColumns: 2 });
  assert.equal(parsed.columnsTruncated, true);
  assert.equal(parsed.truncated, true);
  assert.deepEqual(parsed.header, ["a", "b"]);
  assert.deepEqual(parsed.rows, [["1", "2"]]);
});

test("handles empty input and empty fields", async () => {
  const { parseDelimitedText } = await loadSubject();
  const empty = parseDelimitedText("");
  assert.deepEqual(empty.header, []);
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.columnCount, 0);

  assert.deepEqual(parseDelimitedText("a,b,\n,2,\n").rows, [["", "2", ""]]);
});

test("keeps a literal quote inside an unquoted field", async () => {
  const { parseDelimitedText } = await loadSubject();
  const parsed = parseDelimitedText('a,b\n5" screen,x\n');
  assert.deepEqual(parsed.rows, [['5" screen', "x"]]);
});
