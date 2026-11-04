'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'public/assets/app.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(script.slice(0, script.indexOf('const state =')) + '\nthis.ui = {readable, prepareDisplayRules, esc};', context);
const corrections = JSON.parse(fs.readFileSync(path.join(root, 'baseline/display-overrides.json'), 'utf8'));
context.ui.prepareDisplayRules(corrections);
for (const [code, correction] of Object.entries(corrections)) {
  assert.equal(context.ui.readable(correction.originalText).trim(), correction.displayText, code);
  assert.equal(context.ui.readable(correction.originalText.replace(/\s/g, '')).trim(), correction.displayText, '줄바꿈·띄어쓰기 차이: ' + code);
}
assert.equal(context.ui.esc('<script>"&</script>'), '&lt;script&gt;&quot;&amp;&lt;/script&gt;');
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'baseline/subjects.json'), 'utf8'));
for (const subject of baseline) for (const standard of subject.standards) {
  const display = context.ui.readable(standard.text);
  assert(!/[\uE000-\uF8FF]/.test(display), '성취기준에 깨진 문자 잔존: ' + standard.code);
}
const inquiryDir = path.join(root, 'dist/data/inquiries');
const leftovers = [];
for (const file of fs.readdirSync(inquiryDir)) {
  if (!file.endsWith('.json')) continue;
  const data = JSON.parse(fs.readFileSync(path.join(inquiryDir, file), 'utf8'));
  for (const [code, examples] of Object.entries(data)) for (const example of examples) for (const block of example.blocks) {
    const texts = block.type === 'paragraph' ? [block.text] : block.rows.flatMap(row => row.map(cell => cell.text));
    for (const text of texts) if (/[\uE000-\uF8FF]/.test(context.ui.readable(text, code))) leftovers.push({code, source:example.sources[0].file, text:text.slice(0, 150)});
  }
}
assert.equal(leftovers.length, 0, '예시 안에 깨진 문자 잔존: ' + JSON.stringify(leftovers.slice(0, 5)));
console.log('PASS: 공식 수식 표시 보정 ' + Object.keys(corrections).length + '건, 모든 성취기준·예시의 깨진 문자 검사, HTML 이스케이프');
