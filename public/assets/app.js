'use strict';
let displayRules = [];
let excerptRules = {};
function readable(value, code) {
  let text = String(value ?? '');
  if (!/[\uE000-\uF8FF]/.test(text)) return text;
  for (const rule of displayRules) text = text.replace(rule.pattern, () => rule.target);
  for (const rule of excerptRules[code] || []) text = text.replace(rule.pattern, () => rule.target);
  return text;
}
function prepareDisplayRules(corrections) {
  const makeRule = (original, target) => ({pattern:new RegExp([...original.replace(/\s/g, '')].map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'), 'g'), target});
  displayRules = Object.values(corrections).map(c => {
    const ended = /\.\s*$/.test(c.originalText);
    const original = ended ? c.originalText.trim().slice(0, -1) : c.originalText.trim();
    const target = ended ? c.displayText.trim().replace(/\.$/, '') : c.displayText.trim();
    return makeRule(original, target);
  });
  excerptRules = Object.fromEntries(Object.entries(corrections).map(([code,c]) => [code, (c.excerptReplacements || []).map(r => makeRule(r.original, r.display))]));
}
const $ = s => document.querySelector(s);
const esc = (value, code) => readable(value, code).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = n => Number(n).toLocaleString('ko-KR');
const state = {subjects:[], domain:'', subject:null, selected:null, query:'', area:'', only:false, tab:'standards', format:'all', load:0};
const cache = new Map();
let sourcesPromise, reportPromise, booksPromise;
async function readJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`자료를 불러올 수 없습니다 (${response.status}).`);
  return response.json();
}
function inquiries(subject) {
  if (!cache.has(subject.id)) cache.set(subject.id, readJSON(`data/inquiries/${subject.id}.json`).catch(e => {cache.delete(subject.id); throw e;}));
  return cache.get(subject.id);
}
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('#toast').classList.remove('show'), 2400);
}
async function copy(text) {
  text = readable(text, state.selected?.standard.code);
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
    else {
      const input = document.createElement('textarea'); input.value = text;
      input.style.position = 'fixed'; input.style.opacity = '0'; document.body.append(input); input.select();
      const ok = document.execCommand('copy'); input.remove();
      if (!ok) throw new Error('copy');
    }
    toast('복사했습니다.');
  } catch { toast('복사하지 못했습니다. 내용을 선택해 직접 복사해 주세요.'); }
}
function highlight(text) {
  text = readable(text);
  const query = state.query.trim();
  if (!query) return esc(text);
  const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(text).split(new RegExp(`(${pattern})`, 'gi')).map(t => t.toLowerCase() === query.toLowerCase() ? `<mark>${esc(t)}</mark>` : esc(t)).join('');
}
function empty(message, symbol = '↗') { return `<div class="empty"><span class="empty-symbol" aria-hidden="true">${symbol}</span>${message}</div>`; }
function renderDomains() {
  const domains = [...new Set(state.subjects.map(s => s.domain))];
  $('#domains').innerHTML = domains.map(d => `<button class="${d === state.domain ? 'active' : ''}" data-domain="${esc(d)}" aria-pressed="${d === state.domain}">${esc(d)}</button>`).join('');
}
function renderSubjects() {
  const query = $('#subjectSearch').value.trim().toLowerCase();
  const list = state.subjects.filter(s => query ? s.name.toLowerCase().includes(query) : s.domain === state.domain);
  $('#subjectCount').textContent = `${list.length}과목`;
  let previousGroup = '';
  $('#subjectList').innerHTML = list.map(s => {
    const group = query ? s.domain : s.group;
    const heading = group !== previousGroup ? `<div class="subject-group">${esc(group)}</div>` : '';
    previousGroup = group;
    return heading + `<button class="subject-button ${s.id === state.subject?.id ? 'active' : ''}" data-subject="${s.id}" aria-pressed="${s.id === state.subject?.id}"><span>${esc(s.name)}${s.level ? ' ' + esc(s.level) : ''}</span><span class="count ${s.covered ? 'has' : ''}" title="예시가 있는 성취기준 / 전체 성취기준">${s.covered ? '● ' : ''}${s.covered}/${s.standards.length}</span></button>`;
  }).join('') || empty('해당하는 과목이 없습니다.', '⌕');
}
function rows() {
  const query = state.query.trim().toLowerCase();
  const subjects = query ? state.subjects : [state.subject];
  return subjects.flatMap(subject => subject.standards.filter(st =>
    (!state.only || st.exampleCount > 0) && (!state.area || st.area === state.area) &&
    (!query || `${subject.name} ${subject.domain} ${st.code} [${st.code}] ${st.text} ${st.displayText || ''} ${st.area}`.toLowerCase().includes(query))
  ).map(standard => ({subject, standard})));
}
function renderList() {
  const matches = rows();
  $('#resultCount').textContent = `${number(matches.length)}개`;
  $('#standardList').innerHTML = matches.map(({subject:s, standard:st}) => {
    const selected = state.selected?.subject.id === s.id && state.selected?.standard.code === st.code;
    return `<button class="standard-row ${selected ? 'active' : ''}" data-standard="${esc(st.code)}" data-owner="${s.id}" aria-pressed="${selected}"><div class="code-line"><span class="code">${highlight(st.code)}</span><span class="area-label">${esc(state.query ? s.name : st.area)}</span></div><p>${highlight(st.text)}</p><div class="row-bottom"><span class="badge ${st.exampleCount ? '' : 'muted'}">${st.exampleCount ? `탐구 예시 ${number(st.exampleCount)}건` : '예시 준비 중'}</span><span class="row-arrow" aria-hidden="true">↗</span></div></button>`;
  }).join('') || empty('조건에 맞는 성취기준이 없습니다.<br>검색어나 필터를 바꿔 보세요.', '⌕');
  return matches;
}
function renderHeading() {
  const subject = state.subject;
  $('#subjectMeta').textContent = state.query ? '모든 교과에서 찾기' : `${subject.domain} / ${subject.group}${subject.level ? ' / ' + subject.level : ''}`;
  $('#subjectTitle').textContent = state.query ? '전체 검색 결과' : subject.name;
  const areas = [...new Set(subject.standards.map(st => st.area).filter(Boolean))];
  $('#areaFilter').innerHTML = '<option value="">전체 영역</option>' + areas.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
  $('#areaFilter').value = state.area;
  $('#areaFilter').disabled = Boolean(state.query);
  $('#textbooksTab').disabled = Boolean(state.query);
}
function syncTabs() {
  const isStandards = state.tab === 'standards';
  $('#standardsView').hidden = !isStandards; $('#textbooksView').hidden = isStandards;
  $('#standardsTab').classList.toggle('active', isStandards); $('#textbooksTab').classList.toggle('active', !isStandards);
  $('#standardsTab').setAttribute('aria-pressed', isStandards); $('#textbooksTab').setAttribute('aria-pressed', !isStandards);
}
function setHash() {
  if (!state.selected) return;
  const p = new URLSearchParams({subject:state.selected.subject.id, code:state.selected.standard.code});
  history.replaceState(null, '', '#' + p.toString());
}
async function selectStandard(subject, standard, scroll = false, updateHash = true) {
  state.selected = {subject, standard}; state.format = 'all';
  if (updateHash) setHash();
  renderList();
  await renderDetail();
  if (scroll && matchMedia('(max-width:980px)').matches) $('#detail').scrollIntoView({behavior:'smooth', block:'start'});
}
async function chooseSubject(subject, initialCode = '') {
  state.subject = subject; state.domain = subject.domain; state.area = ''; state.query = ''; state.tab = 'standards';
  $('#globalSearch').value = ''; $('#subjectSearch').value = '';
  renderDomains(); renderSubjects(); renderHeading(); syncTabs();
  const list = renderList();
  const desired = list.find(r => r.standard.code === initialCode) || list[0];
  if (desired) await selectStandard(desired.subject, desired.standard);
  else {state.selected = null; state.load++; $('#detail').innerHTML = empty('이 조건에서 표시할 성취기준이 없습니다.');}
}
function paragraphText(p) {return (p.prefix ? p.prefix + ' ' : '') + p.text;}
function blockText(b) {return b.type === 'paragraph' ? paragraphText(b) : b.rows.map(r => r.map(c => c.paragraphs ? c.paragraphs.map(paragraphText).join('\n') : c.text).join('\t')).join('\n');}
function renderTable(b, code) {
  const first = b.rows[0] || [];
  const firstText = first.map(c => c.text).join(' ');
  const flow = first.length === 3 && /기본/.test(firstText) && /심화/.test(firstText);
  const header = flow || (first.length > 1 && /^(단계|구분|질문 유형|질문유형)/.test(firstText));
  const cols = flow ? '<colgroup><col><col><col></colgroup>' : '';
  const meta = !flow && b.rows.length > 1 && b.rows.every(r => r.length === 2);
  // Keep Word's horizontal and vertical merged cells aligned.
  const starts = b.rows.map(r => {let col = 0; return r.map(c => {const start = col; col += c.span || 1; return start;});});
  const html = b.rows.map((r, ri) => '<tr>' + r.map((c, ci) => {
    if (c.merge === 'continue') return '';
    const tag = ri === 0 && header ? 'th' : 'td';
    let rowspan = 1;
    if (c.merge === 'restart') {
      for (let next = ri + 1; next < b.rows.length; next++) {
        const at = starts[next].indexOf(starts[ri][ci]);
        if (at < 0 || b.rows[next][at].merge !== 'continue') break;
        rowspan++;
      }
    }
    const content = c.paragraphs ? c.paragraphs.map(paragraphText).join('\n') : c.text;
    return `<${tag}${tag === 'th' ? ' scope="col"' : ''}${c.span > 1 ? ` colspan="${c.span}"` : ''}${rowspan > 1 ? ` rowspan="${rowspan}"` : ''}>${esc(content, code)}</${tag}>`;
  }).join('') + '</tr>').join('');
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="탐구 내용 표, 좁은 화면에서는 가로로 스크롤할 수 있습니다"><table class="doc-table ${flow ? 'flow-table' : ''} ${meta ? 'meta-table' : ''}">${cols}<tbody>${html}</tbody></table></div>`;
}
function renderBlocks(blocks, code) {
  return blocks.map(b => {
    if (b.type === 'table') return renderTable(b, code);
    const heading = /heading|제목/i.test(b.style) || (b.text.length < 65 && /^(탐구 흐름|탐구 실행 정보|실행·성찰 정보|▶ 탐구|교사용|연결 진로|기본과 심화|사용 안내|\[\d)/.test(b.text));
    return `<p class="doc-paragraph ${heading ? 'doc-heading' : ''}">${esc(paragraphText(b), code)}</p>`;
  }).join('');
}
function exampleTitle(e, code) {
  for (const b of e.blocks) {
    if (b.type === 'table') {
      const header = b.rows[0]?.map(c => c.text).join(' ') || '';
      if (/기본/.test(header) && b.rows[1]?.[1]) {
        const text = readable(b.rows[1][1].text.split('\n')[0].replace(/^질문[:：]?\s*/, ''), code);
        return text.length > 85 ? text.slice(0, 85) + '…' : text;
      }
    } else if (/^(\[왜|1\.\s*\[왜)/.test(b.text)) {
      const text = readable(b.text.replace(/^\[왜\?\]\s*/, ''), code);
      return text.length > 85 ? text.slice(0, 85) + '…' : text;
    }
  }
  return e.format === 'flow' ? '기본과 심화로 이어가는 연결 탐구' : '질문과 탐구 계획';
}
function exampleHTML(e, index) {
  return `<details class="example-card" open data-example="${e.id}"><summary><span class="example-number">${String(index+1).padStart(2, '0')}</span><span class="example-title">${esc(exampleTitle(e, state.selected?.standard.code))}<small>${e.format === 'flow' ? '연결 탐구 흐름 · 기본 / 심화' : '질문 · 탐구 계획'}${e.sources.length > 1 ? ` · 동일 내용 출처 ${e.sources.length}개` : ''}${e.draft ? ' · 검수 전 초안' : ''}</small></span><span class="chevron" aria-hidden="true">⌄</span></summary><div class="example-body"><div class="source-line">${e.sources.map(s => `출처: <button data-source="${s.id}">${esc(s.file)}</button> · 성취기준 묶음 ${s.section}`).join('<br>')}</div>${e.textReview ? '<div class="review-note">자료 확인 필요 · 문서의 성취기준 표시가 탐색기 원본과 다릅니다(수식·표현 차이 포함). 코드로 연결한 자료이므로 내용의 적합성을 확인해 주세요.</div>' : ''}${e.draft ? '<div class="flow-note">검수 전 초안 · 출처 문서에 교과교사 검토가 필요한 설계 초안으로 명시되어 있습니다. 활동의 적절성과 소요시간을 검토해 사용해 주세요.</div>' : ''}${renderBlocks(e.blocks, state.selected?.standard.code)}<div class="example-footer"><button class="outline" data-copy-example="${e.id}">이 예시 복사</button></div></div></details>`;
}
let currentExamples = [];
async function renderDetail() {
  const token = ++state.load;
  const selected = state.selected;
  if (!selected) {$('#detail').innerHTML = empty('성취기준을 선택해 주세요.'); return;}
  const {subject:s, standard:st} = selected;
  const header = `<div class="detail-heading"><span class="code">${esc(st.code)}</span><h3>${esc(st.displayText || st.text)}</h3><div class="detail-sub"><span>${esc(s.name)}${st.area ? ' · ' + esc(st.area) : ''}</span><span class="badge ${st.exampleCount ? '' : 'muted'}">예시 ${number(st.exampleCount)}건</span></div><div class="detail-actions"><button class="outline" data-action="copy-standard">성취기준 복사</button><button class="outline" data-action="copy-link">링크 복사</button><button class="outline" data-action="print">인쇄</button>${state.corrections?.[st.code] ? '<button class="outline" data-action="correction-info">수식 보정 근거</button>' : ''}</div>${state.corrections?.[st.code] ? '<div class="source-line">원본에서 깨진 수식 표시를 공식 교육과정과 대조해 보정했습니다.</div>' : ''}</div>`;
  $('#detail').innerHTML = header + empty('연결된 예시를 불러오는 중입니다.', '…');
  try {
    const data = await inquiries(s);
    if (token !== state.load) return;
    currentExamples = data[st.code] || [];
    const shown = currentExamples.filter(e => state.format === 'all' || e.format === state.format);
    $('#detail').innerHTML = header + `<div class="examples-heading"><h4>질문·탐구 예시 <b>${number(shown.length)}</b></h4><select id="formatFilter" aria-label="예시 형식 필터"><option value="all">모든 형식</option><option value="flow">연결 탐구 흐름</option><option value="plan">질문·탐구 계획</option></select></div>` +
      (currentExamples.length ? '<div class="flow-note">① 왜? → ② 어떻게? → ③ 무엇이 달라질까?<br>연결 탐구형의 세 단계는 하나의 활동으로 이어집니다. 기본·심화를 나란히 살펴보세요.</div><div class="detail-actions" style="margin:0 0 16px"><button class="outline" data-action="expand">전체 펼치기</button><button class="outline" data-action="collapse">전체 접기</button><button class="outline" data-action="copy-all">표시된 예시 모두 복사</button></div>' : '') +
      (shown.length ? shown.map(exampleHTML).join('') : empty(currentExamples.length ? '이 형식의 예시는 없습니다.<br>다른 형식을 선택해 주세요.' : '아직 등록된 탐구 예시가 없습니다.<br>자료가 추가되면 이 성취기준에 연결해 표시합니다.'));
    $('#formatFilter').value = state.format;
    $('#formatFilter').onchange = e => {state.format = e.target.value; renderDetail();};
  } catch (error) {
    if (token === state.load) $('#detail').innerHTML = header + empty(`${esc(error.message)}<br><button class="text-button" data-action="retry">다시 불러오기</button>`);
  }
}
async function renderTextbooks() {
  const subject = state.subject;
  $('#textbooksView').innerHTML = empty('목차를 불러오는 중입니다.', '…');
  try {
    booksPromise ||= readJSON('data/textbooks.json').catch(e => {booksPromise = null; throw e;});
    const data = await booksPromise;
    if (state.subject.id !== subject.id || state.tab !== 'textbooks') return;
    const books = data.filter(b => b.s === subject.key && b.image);
    if (!books.length) {$('#textbooksView').innerHTML = empty('이 과목에 등록된 교과서 목차가 없습니다.'); return;}
    const draw = index => {
      const book = books[index];
      $('#textbooksView').innerHTML = `<div class="textbook-picker">${books.map((b,i) => `<button class="chip ${i === index ? 'active' : ''}" data-book="${i}" aria-pressed="${i === index}">${esc(b.label)}</button>`).join('')}</div><div class="textbook-image"><img src="${esc(book.image)}" alt="${esc(subject.name + ' ' + book.label + ' 교과서 목차')}" loading="lazy" id="tocImage"><div class="textbook-caption">${esc(subject.name)} · ${esc(book.label)}<br>출처: ${esc(book.src || '원본 탐색기')}<br><button class="text-button" id="zoomImage">크게 보기 ↗</button></div></div>`;
      $('#textbooksView').querySelectorAll('[data-book]').forEach(button => button.onclick = () => draw(Number(button.dataset.book)));
      const zoom = () => {$('#largeImage').src = book.image; $('#largeImage').alt = `${subject.name} ${book.label} 목차`; $('#imageTitle').textContent = `${subject.name} · ${book.label}`; $('#imageDialog').showModal();};
      $('#tocImage').onclick = zoom; $('#zoomImage').onclick = zoom;
    };
    draw(0);
  } catch(error) {$('#textbooksView').innerHTML = empty(esc(error.message));}
}
function showDialog(title, html) {
  $('#dialogTitle').textContent = title; $('#dialogBody').innerHTML = html;
  if (!$('#infoDialog').open) $('#infoDialog').showModal();
  $('#infoDialog').scrollTop = 0;
}
async function sourceInfo(id) {
  try {
    sourcesPromise ||= readJSON('data/sources.json').catch(e => {sourcesPromise = null; throw e;});
    const sources = await sourcesPromise;
    const source = sources.find(s => s.id === id);
    if (!source) return;
    showDialog('출처 문서와 활용 안내', `<p><strong>${esc(source.name)}</strong><br>성취기준별 묶음 ${source.sections}개</p><p>아래는 이 문서에서 첫 번째 성취기준 앞에 실린 안내입니다. 문서의 기본·심화 구분과 활용 조건을 함께 확인해 주세요.</p><div class="source-intro">${renderBlocks(source.intro) || '별도의 앞부분 안내가 없습니다.'}</div>`);
  } catch {toast('출처 정보를 불러오지 못했습니다.');}
}
async function showReport() {
  showDialog('자료 연결 현황', '<p>자료 현황을 불러오는 중입니다.</p>');
  try {
    reportPromise ||= readJSON('data/report.json').catch(e => {reportPromise = null; throw e;});
    const r = await reportPromise, s = r.summary;
    const orphans = r.orphanExamples || [];
    showDialog('자료 연결 현황', `<p>문서 ${number(s.documents)}개에서 예시 ${number(s.examples)}건을 연결했습니다.<br>최종 갱신: ${esc(r.generatedAt.slice(0,16).replace('T',' '))} (한국 시간)</p><div class="status-grid"><div class="status-box"><strong>${number(s.standards)}</strong>전체 성취기준</div><div class="status-box"><strong>${number(s.coveredStandards)}</strong>예시가 있는 성취기준</div><div class="status-box"><strong>${number(s.unmatched)}</strong>연결되지 않은 코드</div><div class="status-box"><strong>${number(s.textDifferences)}</strong>문장 비교 필요</div></div><p>성취기준은 탐색기를 기준으로 유지합니다. 문서의 코드가 같으면 연결하고, 문장이 다르면 예시에 표시합니다. 예시 ${number(s.exactDuplicatesMerged)}건은 내용이 같아 출처를 함께 묶었습니다.</p>${s.displayCorrectionCount ? `<h3>공식 원문과 대조한 수식 표시 보정 ${number(s.displayCorrectionCount)}건</h3><p>원본 탐색기의 수식 문자와 분수식 추출 오류를 보정했습니다. 원본 데이터와 출처 문서는 보존합니다.</p><div class="report-scroll"><table class="report-table"><thead><tr><th>코드</th><th>보정한 표시</th></tr></thead><tbody>${Object.entries(r.displayCorrections || {}).map(([code,c]) => `<tr><td>${esc(code)}</td><td>${esc(c.displayText)}</td></tr>`).join('')}</tbody></table></div>` : ''}${r.unmatched.length ? `<h3>연결되지 않은 예시</h3><p>탐색기에 없는 코드입니다. 임의로 다른 기준에 연결하지 않았으며, 내용은 아래에서 확인할 수 있습니다.</p>${r.unmatched.map((u,i) => `<details><summary>[${esc(u.code)}] ${esc(u.file)} · 묶음 ${u.section}</summary>${orphans[i] ? renderBlocks(orphans[i].blocks) : '연결 보고서에서 원본 위치를 확인해 주세요.'}</details>`).join('')}` : ''}${r.textDifferences.length ? `<h3>성취기준 문장 비교가 필요한 자료</h3><div class="report-scroll"><table class="report-table"><thead><tr><th>과목 / 코드</th><th>출처 파일</th></tr></thead><tbody>${r.textDifferences.map(d => `<tr><td>${esc(d.subject)}<br>${esc(d.code)}</td><td>${esc(d.file)} · 묶음 ${d.section}</td></tr>`).join('')}</tbody></table></div>` : ''}<h3>불러온 문서 ${number(r.files.length)}개</h3><div class="report-scroll"><table class="report-table"><thead><tr><th>파일</th><th>성취기준 묶음</th><th>연결</th></tr></thead><tbody>${r.files.map(f => `<tr><td>${esc(f.file)}</td><td>${f.sections}</td><td>${f.linked}</td></tr>`).join('')}</tbody></table></div><p><a class="report-download" href="data/report.json" download="자료연결보고서.json">연결 보고서 내려받기</a></p>`);
  } catch(error) {showDialog('자료 연결 현황', `<p>${esc(error.message)}</p>`);}
}
function help() {
  showDialog('이용 안내', '<p><strong>성취기준을 출발점으로 질문과 탐구 계획을 살펴보세요.</strong></p><ol><li>교과와 과목을 선택합니다. 과목 옆 숫자는 예시가 있는 성취기준 수 / 전체 성취기준 수입니다.</li><li>성취기준을 누르면 연결된 모든 예시가 펼쳐집니다. 출처가 다른 자료도 함께 표시합니다.</li><li>연결 탐구형은 왜? → 어떻게? → 무엇이 달라질까?가 하나의 흐름입니다. 기본과 심화를 나란히 읽어 주세요.</li><li>출처 파일명을 누르면 해당 문서 앞부분의 활용 안내를 볼 수 있습니다.</li></ol><h3>찾고 나누기</h3><p>상단 검색창은 전체 과목의 성취기준 문장·코드·과목명·영역을 검색합니다. / 키를 누르면 검색창으로 이동합니다. 예시 내용은 브라우저의 찾기(Ctrl+F)로 검색할 수 있습니다. 링크 복사는 선택한 성취기준으로 바로 이동하는 주소를 복사합니다.</p><h3>새 문서를 추가할 때</h3><p>원본 DOCX를 자료 폴더에 추가하고 함께 제공된 ‘자료 갱신’을 실행합니다. 웹에서 사용하는 JSON은 자동 생성됩니다. GitHub Actions로 배포한 경우 저장소의 source-docs 폴더에 DOCX를 추가하면 사이트가 자동 갱신됩니다. 자세한 방법은 프로젝트의 사용안내.md에 있습니다.</p><h3>자료 기준</h3><p>성취기준 문장은 원본 탐색기를 기준으로 표시합니다. 탐구 예시는 제공된 문서의 내용이며 교육과정 원문과의 공식 대조·내용 검수가 완료되었다는 뜻은 아닙니다. 문장 차이와 미연결 코드는 자료 현황에서 볼 수 있습니다. 세특 기록 포인트는 실제 학생 활동을 관찰할 때 참고하는 초점입니다.</p>');
}
function visibleExamples() {return currentExamples.filter(e => state.format === 'all' || e.format === state.format);}
function correctionInfo() {
  const correction = state.corrections?.[state.selected?.standard.code];
  if (!correction) return;
  showDialog('수식 표시 보정 근거', `<p><strong>[${esc(state.selected.standard.code)}]</strong><br>${esc(correction.displayText)}</p><p>원본 탐색기에서 깨지거나 다른 문장에 붙은 수식 표기를 공식 교육과정 본문과 대조해 보정했습니다. 탐구 예시의 내용 검수와는 별도입니다.</p><p>대조 자료: ${esc(correction.sourceTitle)}<br><a href="${esc(correction.sourceUrl)}" target="_blank" rel="noopener noreferrer">교육부 고시 원문 확인</a></p>`);
}
function plainExample(e) {return (e.draft ? '검수 전 초안 · 교과교사 검토가 필요한 자료입니다.\n\n' : '') + e.blocks.map(blockText).join('\n\n') + '\n\n출처: ' + e.sources.map(s => `${s.file} (묶음 ${s.section})`).join(', ');}
function bindEvents() {
  $('#domains').onclick = event => {const b = event.target.closest('[data-domain]'); if (b) chooseSubject(state.subjects.find(s => s.domain === b.dataset.domain));};
  $('#subjectList').onclick = event => {const b = event.target.closest('[data-subject]'); if (b) chooseSubject(state.subjects.find(s => s.id === b.dataset.subject));};
  $('#subjectSearch').oninput = renderSubjects;
  $('#standardList').onclick = event => {
    const b = event.target.closest('[data-standard]'); if (!b) return;
    const subject = state.subjects.find(s => s.id === b.dataset.owner);
    selectStandard(subject, subject.standards.find(st => st.code === b.dataset.standard), true);
  };
  let searchTimer;
  $('#globalSearch').oninput = event => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = event.target.value; state.area = ''; state.tab = 'standards'; renderHeading(); syncTabs();
      const matches = renderList();
      if (!matches.some(r => r.subject.id === state.selected?.subject.id && r.standard.code === state.selected?.standard.code)) {
        if (matches[0]) selectStandard(matches[0].subject, matches[0].standard);
        else {state.selected = null; state.load++; $('#detail').innerHTML = empty('검색 결과가 없습니다. 다른 검색어를 입력해 주세요.', '⌕');}
      }
    }, 130);
  };
  const changeFilter = () => {
    const matches = renderList();
    if (!matches.some(r => r.subject.id === state.selected?.subject.id && r.standard.code === state.selected?.standard.code)) {
      if (matches[0]) selectStandard(matches[0].subject, matches[0].standard);
      else {state.selected = null; state.load++; $('#detail').innerHTML = empty('조건에 맞는 성취기준이 없습니다.');}
    }
  };
  $('#onlyExamples').onchange = e => {state.only = e.target.checked; changeFilter();};
  $('#areaFilter').onchange = e => {state.area = e.target.value; changeFilter();};
  $('#standardsTab').onclick = () => {state.tab = 'standards'; syncTabs();};
  $('#textbooksTab').onclick = () => {state.tab = 'textbooks'; syncTabs(); renderTextbooks();};
  $('#detail').onclick = event => {
    const source = event.target.closest('[data-source]'); if (source) {sourceInfo(source.dataset.source); return;}
    const single = event.target.closest('[data-copy-example]');
    if (single) {const e = currentExamples.find(e => e.id === single.dataset.copyExample); if (e) copy(plainExample(e)); return;}
    const b = event.target.closest('[data-action]'); if (!b || !state.selected) return;
    const {standard:st} = state.selected;
    switch(b.dataset.action) {
      case 'copy-standard': copy(`[${st.code}] ${st.text}`); break;
      case 'copy-link': copy(location.href); break;
      case 'expand': $('#detail').querySelectorAll('.example-card').forEach(e => e.open = true); break;
      case 'collapse': $('#detail').querySelectorAll('.example-card').forEach(e => e.open = false); break;
      case 'copy-all': copy(`[${st.code}] ${st.text}\n\n` + visibleExamples().map(plainExample).join('\n\n────────────\n\n')); break;
      case 'print': $('#detail').querySelectorAll('.example-card').forEach(e => e.open = true); window.print(); break;
      case 'retry': renderDetail(); break;
      case 'correction-info': correctionInfo(); break;
    }
  };
  $('#reportButton').onclick = showReport; $('#footerReport').onclick = showReport; $('#helpButton').onclick = help;
  $('#closeDialog').onclick = () => $('#infoDialog').close(); $('#closeImage').onclick = () => $('#imageDialog').close();
  for (const dialog of document.querySelectorAll('dialog')) dialog.onclick = event => {if (event.target === dialog) {const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();}};
  document.addEventListener('keydown', event => {if (event.key === '/' && !event.ctrlKey && !event.metaKey && !/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) && !document.querySelector('dialog[open]')) {event.preventDefault(); $('#globalSearch').focus();}});
  window.addEventListener('hashchange', () => {const p = new URLSearchParams(location.hash.slice(1)); const subject = state.subjects.find(s => s.id === p.get('subject')); if (subject) chooseSubject(subject, p.get('code'));});
}
async function init() {
  if (location.protocol === 'file:') {
    $('#detail').innerHTML = empty('「실행.cmd」를 더블클릭해 탐색기를 열어 주세요.<br>파일을 직접 열면 브라우저가 자료 불러오기를 제한합니다.');
    $('#subjectTitle').textContent = '실행 방법 안내'; return;
  }
  try {
    const catalog = await readJSON('data/catalog.json');
    state.corrections = catalog.displayCorrections || {};
    prepareDisplayRules(state.corrections);
    state.subjects = catalog.subjects;
    const s = catalog.summary;
    $('#metrics').innerHTML = [[s.subjects,'과목 항목'],[s.coveredStandards,'예시가 있는 성취기준'],[s.examples,'연결된 탐구 예시']].map(([n,t]) => `<div class="metric"><strong>${number(n)}</strong><span>${t}</span></div>`).join('');
    $('#updatedAt').textContent = '자료 갱신 ' + catalog.generatedAt.slice(0,10).replaceAll('-', '.');
    bindEvents();
    const p = new URLSearchParams(location.hash.slice(1));
    const initial = state.subjects.find(s => s.id === p.get('subject')) || state.subjects[0];
    await chooseSubject(initial, p.get('code'));
  } catch(error) {
    $('#subjectTitle').textContent = '자료를 불러오지 못했습니다';
    $('#detail').innerHTML = empty(`${esc(error.message)}<br>자료 갱신 후 새로고침해 주세요.`);
  }
}
init();
