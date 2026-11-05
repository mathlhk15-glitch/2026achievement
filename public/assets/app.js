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
const state = {subjects:[], domain:'', subject:null, selected:null, query:'', area:'', exampleFilter:'', tab:'standards', format:'all', status:'usable', load:0, focusExample:''};
const cache = new Map();
let sourcesPromise, reportPromise, booksPromise;
// Example-content search: the index is loaded only when someone searches.
let searchIndex = null, searchPromise = null, contentCache = {query:'', map:new Map()};
const terms = q => q.trim().toLowerCase().split(/\s+/).filter(Boolean);
const matchesAll = (text, ts) => ts.every(t => text.includes(t));
function loadSearchIndex() {
  searchPromise ||= readJSON('data/search.json').then(data => {
    searchIndex = {};
    for (const [sid, codes] of Object.entries(data)) for (const [code, list] of Object.entries(codes)) searchIndex[sid + '|' + code] = list.map(([id, text, title, careers, status]) => [id, text.toLowerCase(), title || '', careers || '', status || 'general']);
    contentCache = {query:'', map:new Map()};
    return searchIndex;
  }).catch(e => {searchPromise = null; throw e;});
  return searchPromise;
}
function contentMatches() {
  const q = state.query.trim().toLowerCase();
  if (!searchIndex || q.length < 2) return new Map();
  if (contentCache.query === q) return contentCache.map;
  const ts = terms(q), map = new Map();
  for (const [key, list] of Object.entries(searchIndex)) {
    const ids = list.filter(([, text]) => matchesAll(text, ts)).map(([id]) => id);
    if (ids.length) map.set(key, ids);
  }
  contentCache = {query:q, map};
  return map;
}
// 'verified' only when a subject teacher recorded it in baseline/teacher-reviewed.json.
// 'general' means no draft label and no text mismatch — not that a teacher reviewed it.
const statusOf = e => e.status || (e.verified ? 'verified' : e.textReview ? 'review' : e.draft ? 'draft' : 'general');
const STATUS = {verified:['교과 검토 완료', 'ok'], general:['일반 예시', 'general'], draft:['검수 전 초안', 'draft'], review:['자료 확인 필요', 'check']};
const STATUS_TIP = {verified:'교과교사가 내용을 확인한 자료입니다.', general:'초안 표시가 없는 참고 예시입니다. 교과 검토 여부는 확인되지 않았습니다.', draft:'출처 문서에 교과교사 검토 전 초안으로 적혀 있습니다.', review:'문서의 성취기준 문장이 탐색기 원문과 달라 확인이 필요합니다.'};
const usable = status => status === 'verified' || status === 'general';
const statusChip = status => `<span class="status-chip ${STATUS[status][1]}" title="${STATUS_TIP[status]}">${STATUS[status][0]}</span>`;
function sourceName(file) {
  const parts = file.replace(/\.docx$/i, '').split('/');
  const name = parts.pop().replace(/_/g, ' ');
  return (parts.length ? parts.join(' › ') + ' › ' : '') + name;
}
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
  const ts = terms(query);
  const pattern = ts.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return String(text).split(new RegExp(`(${pattern})`, 'gi')).map(t => ts.includes(t.toLowerCase()) ? `<mark>${esc(t)}</mark>` : esc(t)).join('');
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
  const ts = terms(query);
  const content = query ? contentMatches() : new Map();
  const subjects = query ? state.subjects : [state.subject];
  const result = [];
  for (const subject of subjects) for (const st of subject.standards) {
    if (state.exampleFilter === 'any' && !st.exampleCount) continue;
    if (state.exampleFilter === 'usable' && !st.usableCount) continue;
    if (state.exampleFilter === 'verified' && !st.verifiedCount) continue;
    if (!query && state.area && st.area !== state.area) continue;
    const own = !query || matchesAll(`${subject.name} ${subject.domain} ${st.code} [${st.code}] ${readable(st.text, st.code)} ${st.displayText || ''} ${st.area}`.toLowerCase(), ts);
    const hits = content.get(subject.id + '|' + st.code)?.length || 0;
    if (own || hits) result.push({subject, standard:st, own, hits});
  }
  // Standards whose own text matches come first, then those found through example content.
  if (query) result.sort((a, b) => (b.own - a.own) || (b.hits - a.hits));
  return result;
}
function hitsOf(s, st) {return state.query.trim() ? (contentMatches().get(s.id + '|' + st.code)?.length || 0) : 0;}
function renderList() {
  const matches = rows();
  $('#resultCount').textContent = `${number(matches.length)}개`;
  $('#standardList').innerHTML = matches.map(({subject:s, standard:st}) => {
    const selected = state.selected?.subject.id === s.id && state.selected?.standard.code === st.code;
    return `<button class="standard-row ${selected ? 'active' : ''}" data-standard="${esc(st.code)}" data-owner="${s.id}" aria-pressed="${selected}"><div class="code-line"><span class="code">${highlight(st.code)}</span><span class="area-label">${esc(state.query ? s.name : st.area)}</span></div><p>${highlight(st.text)}</p><div class="row-bottom"><span class="badge ${st.exampleCount ? '' : 'muted'}">${st.exampleCount ? `탐구 예시 ${number(st.exampleCount)}건` : '예시 준비 중'}</span>${st.verifiedCount ? `<span class="badge ok">교과 검토 ${number(st.verifiedCount)}</span>` : ''}${st.exampleCount && !st.usableCount ? '<span class="badge draft">초안·확인 필요만</span>' : ''}${hitsOf(s, st) ? `<span class="badge hit">예시 내용 일치 ${number(hitsOf(s, st))}</span>` : ''}<span class="row-arrow" aria-hidden="true">↗</span></div></button>`;
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
  state.selected = {subject, standard}; state.format = 'all'; state.status = 'usable';
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
function queryHit(e) {const ids = state.query.trim() && state.selected ? contentMatches().get(state.selected.subject.id + '|' + state.selected.standard.code) : null; return Boolean(ids && ids.includes(e.id));}
function exampleHTML(e, index) {
  return `<details class="example-card" open data-example="${e.id}"><summary><span class="example-number">${String(index+1).padStart(2, '0')}</span><span class="example-title">${esc(exampleTitle(e, state.selected?.standard.code))}<small>${statusChip(statusOf(e))}${queryHit(e) ? '<span class="status-chip hit">검색어 포함</span>' : ''}${e.format === 'flow' ? '연결 탐구 흐름 · 기본 / 심화' : '질문 · 탐구 계획'}${e.sources.length > 1 ? ` · 동일 내용 출처 ${e.sources.length}개` : ''}</small></span><span class="chevron" aria-hidden="true">⌄</span></summary><div class="example-body"><div class="source-line">${e.sources.map(s => `출처: <button data-source="${s.id}" title="${esc(s.file)}">${esc(sourceName(s.file))}</button> · 성취기준 묶음 ${s.section}`).join('<br>')}</div>${e.textReview ? '<div class="review-note">자료 확인 필요 · 문서의 성취기준 표시가 탐색기 원본과 다릅니다(수식·표현 차이 포함). 코드로 연결한 자료이므로 내용의 적합성을 확인해 주세요.</div>' : ''}${e.draft ? '<div class="flow-note">검수 전 초안 · 출처 문서에 교과교사 검토가 필요한 설계 초안으로 명시되어 있습니다. 활동의 적절성과 소요시간을 검토해 사용해 주세요.</div>' : ''}${renderBlocks(e.blocks, state.selected?.standard.code)}<div class="remix-note"><b>그대로 쓰지 말고 바꾸기</b> ① 대상 바꾸기(우리 반·우리 학교·창원) ② 범위 줄이기(이번 주 안에 확인할 크기) ③ 확인 방법 정하기(관찰·측정·설문·자료)</div><div class="example-footer"><button class="primary-small" data-plan-example="${e.id}">이 예시로 내 탐구 시작하기</button><button class="outline" data-save-example="${e.id}">${isSaved(state.selected?.subject.id, state.selected?.standard.code, e.id) ? '★ 보관함에 있음' : '☆ 보관하기'}</button><button class="outline" data-copy-example="${e.id}">이 예시 복사</button></div></div></details>`;
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
    const shown = visibleExamples();
    const counts = {verified:0, general:0, draft:0, review:0};
    currentExamples.forEach(e => counts[statusOf(e)]++);
    $('#detail').innerHTML = header + `<div class="examples-heading"><h4>질문·탐구 예시 <b>${number(shown.length)}</b></h4><div class="example-filters"><select id="statusFilter" aria-label="자료 상태 필터"><option value="usable">초안 제외 (${counts.verified + counts.general})</option><option value="all">모든 상태 (${currentExamples.length})</option><option value="verified">교과 검토 완료 (${counts.verified})</option><option value="general">일반 예시 (${counts.general})</option><option value="draft">검수 전 초안 (${counts.draft})</option><option value="review">자료 확인 필요 (${counts.review})</option></select><select id="formatFilter" aria-label="예시 형식 필터"><option value="all">모든 형식</option><option value="flow">연결 탐구 흐름</option><option value="plan">질문·탐구 계획</option></select></div></div>` +
      (currentExamples.length ? '<div class="flow-note">① 왜? → ② 어떻게? → ③ 무엇이 달라질까?<br>연결 탐구형의 세 단계는 하나의 활동으로 이어집니다. <b>기본</b>은 수업·과제 시간에 가볍게 해 보는 수준, <b>심화</b>는 시간을 더 들여 자료·실험으로 깊게 해 보는 수준입니다.</div><div class="detail-actions" style="margin:0 0 16px"><button class="outline" data-action="expand">전체 펼치기</button><button class="outline" data-action="collapse">전체 접기</button><button class="outline" data-action="copy-all">표시된 예시 모두 복사</button></div>' : '') +
      (shown.length ? shown.map(exampleHTML).join('') : empty(currentExamples.length ? (state.status === 'usable' && counts.draft + counts.review ? `이 성취기준에는 검수 전 초안·자료 확인 필요 예시만 있습니다.<br><button class="text-button" data-action="show-all">모든 상태 보기 (${counts.draft + counts.review}건)</button>` : '이 조건의 예시는 없습니다.<br>상태나 형식을 바꿔 보세요.') : '아직 등록된 탐구 예시가 없습니다.<br>자료가 추가되면 이 성취기준에 연결해 표시합니다.'));
    $('#formatFilter').value = state.format;
    $('#formatFilter').onchange = e => {state.format = e.target.value; renderDetail();};
    $('#statusFilter').value = state.status;
    $('#statusFilter').onchange = e => {state.status = e.target.value; renderDetail();};
    if (state.focusExample) {
      const target = $('#detail').querySelector(`[data-example="${CSS.escape(state.focusExample)}"]`);
      state.focusExample = '';
      if (target) {target.open = true; target.classList.add('focused'); setTimeout(() => target.scrollIntoView({behavior:'smooth', block:'start'}), 60);}
    }
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
  showDialog('이용 안내', '<h3>학생</h3><ol><li>첫 화면에서 지금 필요한 것을 고릅니다. <strong>과목으로 · 진로로 · 추천받기 · 단어로</strong> 찾을 수 있습니다.</li><li>결과는 <strong>탐구 주제 → 과목 → 성취기준</strong> 순서로 보입니다. ‘자세히 보기’를 누르면 기본·심화 단계가 있는 전체 예시가 열립니다.</li><li>마음에 드는 예시는 <strong>☆ 보관하기</strong>, 내 탐구로 바꾸려면 <strong>이 예시로 내 탐구 시작하기</strong>를 누릅니다. 계획서는 이 기기 브라우저에만 저장되며 인쇄하거나 PDF로 저장할 수 있습니다.</li><li>예시는 출발점입니다. <strong>대상 바꾸기 → 범위 줄이기 → 확인 방법 정하기</strong> 3단계로 내 질문을 만드세요. 같은 예시를 여러 학생이 그대로 쓰면 비슷한 기록이 반복됩니다.</li></ol><h3>자료 상태 표시</h3><ul><li><span class="status-chip ok">교과 검토 완료</span> 교과교사가 내용을 확인했다고 기록한 자료</li><li><span class="status-chip general">일반 예시</span> 초안 표시가 없는 참고 예시(교과 검토 여부는 확인되지 않음)</li><li><span class="status-chip draft">검수 전 초안</span> 출처 문서에 교과교사 검토 전 초안으로 적힌 자료</li><li><span class="status-chip check">자료 확인 필요</span> 문서의 성취기준 문장이 원문과 달라 확인이 필요한 자료</li></ul><p>학생 화면은 기본으로 초안·확인 필요 자료를 빼고 보여 줍니다. 상세 화면의 상태 필터에서 모두 볼 수 있습니다.</p><h3>선생님</h3><p>‘교과별 전체 자료’에서 교과 → 과목 → 성취기준 순서로 모든 예시를 볼 수 있습니다. 검색창은 성취기준 문장·코드·과목명과 탐구 예시 내용까지 찾습니다(/ 키). 확인한 자료는 저장소의 <code>baseline/teacher-reviewed.json</code>에 적으면 ‘교과 검토 완료’로 표시됩니다. 예시 id는 ‘이 예시 복사’ 내용 끝에 있습니다.</p><h3>자료 기준</h3><p>성취기준 문장은 원본 탐색기를 기준으로 표시합니다. 탐구 예시는 제공된 문서의 내용이며, 성취기준에 연결되었다는 것이 학년 적합성·난이도·내용 정확성까지 확인되었다는 뜻은 아닙니다. 실제 활동에 활용할 때는 교과 담당 선생님과 내용과 수준을 확인하세요.</p><h3>새 문서를 추가할 때</h3><p>저장소의 source-docs 폴더에 DOCX를 추가하면 GitHub Actions가 자동으로 변환·검증해 사이트를 갱신합니다. 자세한 방법은 사용안내.md에 있습니다.</p>');
}
function visibleExamples() {
  const list = currentExamples.filter(e => (state.format === 'all' || e.format === state.format) && (state.status === 'all' || (state.status === 'usable' ? usable(statusOf(e)) : statusOf(e) === state.status)));
  return state.query.trim() ? [...list].sort((a, b) => queryHit(b) - queryHit(a)) : list;
}
function correctionInfo() {
  const correction = state.corrections?.[state.selected?.standard.code];
  if (!correction) return;
  showDialog('수식 표시 보정 근거', `<p><strong>[${esc(state.selected.standard.code)}]</strong><br>${esc(correction.displayText)}</p><p>원본 탐색기에서 깨지거나 다른 문장에 붙은 수식 표기를 공식 교육과정 본문과 대조해 보정했습니다. 탐구 예시의 내용 검수와는 별도입니다.</p><p>대조 자료: ${esc(correction.sourceTitle)}<br><a href="${esc(correction.sourceUrl)}" target="_blank" rel="noopener noreferrer">교육부 고시 원문 확인</a></p>`);
}
function plainExample(e) {const st = statusOf(e); return `[${STATUS[st][0]}] ${STATUS_TIP[st]}\n참고 자료입니다. 그대로 쓰지 말고 내 질문으로 바꾸어 활용하세요.\n\n` + e.blocks.map(blockText).join('\n\n') + '\n\n출처: ' + e.sources.map(s => `${s.file} (묶음 ${s.section})`).join(', ') + `\n예시 id: ${e.id}`;}
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
      runContentSearch();
      const matches = renderList();
      if (!matches.some(r => r.subject.id === state.selected?.subject.id && r.standard.code === state.selected?.standard.code)) {
        if (matches[0]) selectStandard(matches[0].subject, matches[0].standard);
        else {state.selected = null; state.load++; $('#detail').innerHTML = empty('검색 결과가 없습니다. 다른 검색어를 입력해 주세요.', '⌕');}
      }
    }, 130);
  };
  function runContentSearch() {
    if (state.query.trim().length < 2) {$('#searchStatus').textContent = ''; return;}
    if (searchIndex) {$('#searchStatus').textContent = '탐구 예시 내용까지 검색했습니다'; return;}
    $('#searchStatus').textContent = '탐구 예시 내용 검색 준비 중…';
    loadSearchIndex().then(() => {
      $('#searchStatus').textContent = '탐구 예시 내용까지 검색했습니다';
      if (state.query.trim()) {const matches = renderList(); if (!state.selected && matches[0]) selectStandard(matches[0].subject, matches[0].standard); else if (state.selected) renderDetail();}
    }).catch(() => {$('#searchStatus').textContent = '예시 내용 검색을 불러오지 못해 성취기준만 검색했습니다';});
  }
  // Students' searches show topic cards first (주제 → 과목 → 성취기준); the explorer keeps the full list.
  $('#heroSearchForm').onsubmit = event => {event.preventDefault(); const q = $('#heroSearch').value.trim(); if (q) openFinder('search', {query:q});};
  $('#topicChips').onclick = event => {const b = event.target.closest('[data-topic]'); if (b) {$('#heroSearch').value = b.dataset.topic; openFinder('search', {query:b.dataset.topic});}};
  const changeFilter = () => {
    const matches = renderList();
    if (!matches.some(r => r.subject.id === state.selected?.subject.id && r.standard.code === state.selected?.standard.code)) {
      if (matches[0]) selectStandard(matches[0].subject, matches[0].standard);
      else {state.selected = null; state.load++; $('#detail').innerHTML = empty('조건에 맞는 성취기준이 없습니다.');}
    }
  };
  $('#exampleFilter').onchange = e => {state.exampleFilter = e.target.value; changeFilter();};
  $('#areaFilter').onchange = e => {state.area = e.target.value; changeFilter();};
  $('#standardsTab').onclick = () => {state.tab = 'standards'; syncTabs();};
  $('#textbooksTab').onclick = () => {state.tab = 'textbooks'; syncTabs(); renderTextbooks();};
  $('#detail').onclick = event => {
    const source = event.target.closest('[data-source]'); if (source) {sourceInfo(source.dataset.source); return;}
    const planBtn = event.target.closest('[data-plan-example]');
    if (planBtn) {const e = currentExamples.find(e => e.id === planBtn.dataset.planExample); if (e) openPlan(planFromSelection(e)); return;}
    const saveBtn = event.target.closest('[data-save-example]');
    if (saveBtn) {const e = currentExamples.find(e => e.id === saveBtn.dataset.saveExample); if (e) {const {subject:s, standard:st} = state.selected; const on = toggleSaved({sid:s.id, code:st.code, id:e.id, title:exampleTitle(e, st.code), subject:s.name}); saveBtn.textContent = on ? '★ 보관함에 있음' : '☆ 보관하기';} return;}
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
      case 'show-all': state.status = 'all'; renderDetail(); break;
    }
  };
  $('#reportButton').onclick = showReport; $('#footerReport').onclick = showReport; $('#helpButton').onclick = help;
  $('#closeDialog').onclick = () => $('#infoDialog').close(); $('#closeImage').onclick = () => $('#imageDialog').close();
  bindStudentEvents();
  for (const dialog of document.querySelectorAll('dialog')) dialog.onclick = event => {if (event.target === dialog) {const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();}};
  document.addEventListener('keydown', event => {if (event.key === '/' && !event.ctrlKey && !event.metaKey && !/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) && !document.querySelector('dialog[open]')) {event.preventDefault(); $('#globalSearch').focus();}});
  window.addEventListener('hashchange', () => {const p = new URLSearchParams(location.hash.slice(1)); const subject = state.subjects.find(s => s.id === p.get('subject')); if (subject) {state.focusExample = p.get('ex') || ''; chooseSubject(subject, p.get('code'));}});
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
    const fourth = s.verifiedExamples ? [number(s.verifiedExamples), '교과 검토 완료 예시', '교과교사가 확인한 자료만 표시'] : [number(s.usableExamples), '초안이 아닌 참고 예시', `검수 전 초안 ${number(s.draftExamples)} · 확인 필요 ${number(s.reviewExamples)}건은 따로 표시`];
    $('#metrics').innerHTML = [[number(s.subjects),'과목'],[number(s.standards),'성취기준', `${number(s.coveredStandards)}개에 예시 연결`],[number(s.examples),'질문·탐구 예시', `출처 문서 ${number(s.documents)}개`], fourth].map(([n,t,sub]) => `<div class="metric"><strong>${n}</strong><span>${t}</span>${sub ? `<small>${sub}</small>` : ''}</div>`).join('');
    $('#updatedAt').textContent = '자료 갱신 ' + catalog.generatedAt.slice(0,10).replaceAll('-', '.');
    bindEvents();
    const p = new URLSearchParams(location.hash.slice(1));
    const initial = state.subjects.find(s => s.id === p.get('subject')) || state.subjects[0];
    state.focusExample = p.get('ex') || '';
    readJSON('data/school.json').then(d => {state.school = d || {};}).catch(() => {state.school = {};});
    renderShelfCount();
    await chooseSubject(initial, p.get('code'));
  } catch(error) {
    $('#subjectTitle').textContent = '자료를 불러오지 못했습니다';
    $('#detail').innerHTML = empty(`${esc(error.message)}<br>자료 갱신 후 새로고침해 주세요.`);
  }
}
/* ===== v3: student entry, finder, saved items, inquiry plan, parent guide ===== */
const CAREERS = [
  {id:'ai', label:'인공지능·컴퓨터', keys:['인공지능','컴퓨터','소프트웨어','데이터과학','데이터 과학','정보','프로그래밍','ai']},
  {id:'eng', label:'공학·기계·전자', keys:['공학','기계','전자','전기','반도체','로봇','건축','토목','자동차','항공']},
  {id:'med', label:'의학·보건·생명', keys:['의학','의료','간호','보건','약학','생명','바이오','재활','치의','한의']},
  {id:'sci', label:'자연과학·수학', keys:['물리','화학','지구과학','천문','수학','통계','과학 연구']},
  {id:'env', label:'환경·에너지', keys:['환경','에너지','기후','생태','지속가능','해양']},
  {id:'biz', label:'경영·경제·금융', keys:['경영','경제','금융','무역','회계','마케팅','창업','유통']},
  {id:'law', label:'법·정치·행정', keys:['법학','법률','정치','외교','행정','정책','공공']},
  {id:'soc', label:'사회·심리·교육', keys:['사회학','심리','상담','교육','복지','인사']},
  {id:'media', label:'언론·미디어·콘텐츠', keys:['언론','미디어','콘텐츠','영상','출판','편집','광고','홍보','방송']},
  {id:'lang', label:'어문·국제·관광', keys:['통번역','국제','지역학','외국어','영어','관광','어문']},
  {id:'hum', label:'인문·역사·철학', keys:['철학','역사','문학','국문','인문','고고','기록']},
  {id:'art', label:'예술·디자인·체육', keys:['디자인','미술','음악','작곡','연기','공연','체육','스포츠','무용','사진']}
];
const METHODS = [
  {id:'data', label:'자료·데이터 분석', keys:['데이터','통계','그래프','자료 분석','비교 분석','분석한다']},
  {id:'lab', label:'실험·관찰', keys:['실험','관찰','측정','관측']},
  {id:'survey', label:'설문·인터뷰', keys:['설문','인터뷰','면담']},
  {id:'make', label:'만들기·발표', keys:['제작','설계','만들','캠페인','발표','프로그램']}
];
const PAGE = 24;
const finder = {mode:'', grade:'', career:'', method:'', level:'', subject:'', query:'', limit:PAGE};
const subjectById = id => state.subjects.find(s => s.id === id);
const standardOf = (sid, code) => subjectById(sid)?.standards.find(st => st.code === code);
const hasAny = (text, keys) => keys.find(k => text.includes(k.toLowerCase()));
function schoolSubjects(grade) {return state.school?.grades?.[grade]?.subjects || [];}
function inGrade(subject, grade) {
  if (!grade) return true;
  const list = schoolSubjects(grade);
  if (list.length) return list.includes(subject.name);
  return grade === '1' ? subject.group === '공통' : subject.group !== '공통';
}
// ---- storage (this browser only; failures fall back to memory) ----
const STORE_KEY = 'inquiry-compass-v1';
let memoryStore = {saved:[], plans:[]};
function store() {try {const raw = localStorage.getItem(STORE_KEY); if (raw) memoryStore = Object.assign({saved:[], plans:[]}, JSON.parse(raw));} catch {} return memoryStore;}
function persist(data) {memoryStore = data; try {localStorage.setItem(STORE_KEY, JSON.stringify(data)); return true;} catch {return false;}}
const savedKey = (sid, code, id) => `${sid}|${code}|${id}`;
function isSaved(sid, code, id) {return Boolean(sid) && store().saved.some(x => x.key === savedKey(sid, code, id));}
function toggleSaved(item) {
  const data = store(), key = savedKey(item.sid, item.code, item.id);
  const at = data.saved.findIndex(x => x.key === key);
  if (at >= 0) data.saved.splice(at, 1); else data.saved.unshift({...item, key, at:Date.now()});
  const ok = persist(data); renderShelfCount();
  toast(at >= 0 ? '보관함에서 뺐습니다.' : ok ? '보관함에 넣었습니다. 이 기기 브라우저에만 저장됩니다.' : '이 브라우저는 저장을 막고 있어 창을 닫으면 사라집니다.');
  return at < 0;
}
function renderShelfCount() {const d = store(); const n = d.saved.length + d.plans.length; $('#shelfCount').textContent = n ? n : '';}
// ---- finder ----
function finderCandidates() {
  const list = [];
  for (const [key, rows] of Object.entries(searchIndex || {})) {
    const [sid, code] = key.split('|');
    const subject = subjectById(sid);
    if (!subject) continue;
    for (const [id, text, title, careers, status] of rows) {
      if (!$('#includeDrafts').checked && !usable(status)) continue;
      list.push({sid, code, id, text, title, careers, status, subject});
    }
  }
  return list;
}
function diversify(items, perStandard = 1, perSubject = 3) {
  const st = new Map(), su = new Map(), out = [];
  for (const it of items) {
    const a = st.get(it.sid + it.code) || 0, b = su.get(it.sid) || 0;
    if (a >= perStandard || b >= perSubject) continue;
    st.set(it.sid + it.code, a + 1); su.set(it.sid, b + 1); out.push(it);
  }
  return out;
}
function finderResults() {
  const all = finderCandidates();
  if (finder.mode === 'subject') {
    if (!finder.subject) return null;
    return diversify(all.filter(c => c.sid === finder.subject), 1, 999);
  }
  if (finder.mode === 'search') {
    const ts = terms(finder.query);
    if (!ts.length) return null;
    const hits = all.filter(c => matchesAll(c.text, ts));
    hits.forEach(c => {c.score = (matchesAll(c.title.toLowerCase(), ts) ? 2 : 0) + (usable(c.status) ? 1 : 0);});
    return diversify(hits.sort((a, b) => b.score - a.score), 1, 6);
  }
  const career = CAREERS.find(c => c.id === finder.career);
  const method = METHODS.find(m => m.id === finder.method);
  if (finder.mode === 'career' && !career) return null;
  if (finder.mode === 'quiz' && !(finder.grade && career && finder.method && finder.level)) return null;
  const scored = [];
  for (const c of all) {
    if (!inGrade(c.subject, finder.grade)) continue;
    const careers = c.careers.toLowerCase();
    let score = 0, why = [];
    const ck = hasAny(careers, career.keys);
    if (ck) {score += 3; why.push(`연결 진로에 ‘${ck}’`);}
    else if (!careers && hasAny(c.text, career.keys)) {score += 1; why.push('내용에 관련 단어');}
    if (!score) continue;
    if (method) {const mk = hasAny(c.text, method.keys); if (mk) {score += 2; why.push(`탐구 방법: ${method.label}`);} else if (finder.mode === 'quiz') score -= 1;}
    if (c.status === 'verified') score += 1;
    // stable pseudo-random order within the same score so results vary across standards
    scored.push({...c, score, why, tie:(c.id.charCodeAt(3) * 31 + c.code.length * 7) % 97});
  }
  scored.sort((a, b) => b.score - a.score || a.tie - b.tie);
  return finder.mode === 'quiz' ? diversify(scored, 1, 1).slice(0, 6) : diversify(scored, 1, 3);
}
function chipGroup(name, items, value) {
  return `<div class="chip-group" role="group" aria-label="${name}">${items.map(([v, label]) => `<button type="button" class="pick ${v === value ? 'on' : ''}" data-pick="${name}" data-value="${esc(v)}" aria-pressed="${v === value}">${esc(label)}</button>`).join('')}</div>`;
}
const GRADES = [['1','고1'],['2','고2'],['3','고3']];
function finderControls() {
  const grade = chipGroup('grade', finder.mode === 'quiz' ? GRADES : [['','전체 학년'], ...GRADES], finder.grade);
  if (finder.mode === 'subject') {
    const list = schoolSubjects(finder.grade);
    const subjects = finder.grade && list.length ? list.map(n => state.subjects.find(s => s.name === n)).filter(Boolean)
      : state.subjects.filter(s => inGrade(s, finder.grade));
    const note = finder.grade && !list.length ? `<p class="finder-note">${finder.grade === '1' ? '' : '학교 개설 과목표가 등록되면 이 학년 과목만 먼저 보여 줍니다. 지금은 공통과목을 뺀 전체 선택 과목입니다. '}과목 이름으로도 찾을 수 있습니다.</p>` : (list.length ? `<p class="finder-note">${esc(state.school.school || '우리 학교')} ${esc(state.school.grades[finder.grade].label || '')} 과목입니다.</p>` : '');
    const byDomain = {};
    subjects.forEach(s => (byDomain[s.domain] ||= []).push(s));
    return `<div class="q"><span class="q-label">학년</span>${grade}</div>${note}<div class="subject-picks">${Object.entries(byDomain).map(([d, ss]) => `<div class="subject-pick-row"><span>${esc(d)}</span><div>${ss.map(s => `<button type="button" class="pick ${s.id === finder.subject ? 'on' : ''}" data-pick="subject" data-value="${s.id}">${esc(s.name)}</button>`).join('')}</div></div>`).join('')}</div>`;
  }
  if (finder.mode === 'career') return `<div class="q"><span class="q-label">관심 계열</span>${chipGroup('career', CAREERS.map(c => [c.id, c.label]), finder.career)}</div><div class="q"><span class="q-label">학년</span>${grade}</div>`;
  if (finder.mode === 'quiz') return `<ol class="quiz"><li><span class="q-label">현재(또는 내년) 학년</span>${grade}</li><li><span class="q-label">관심 있는 분야</span>${chipGroup('career', CAREERS.map(c => [c.id, c.label]), finder.career)}</li><li><span class="q-label">해 보고 싶은 탐구 방식</span>${chipGroup('method', METHODS.map(m => [m.id, m.label]), finder.method)}</li><li><span class="q-label">희망 난이도</span>${chipGroup('level', [['basic','기본 · 가볍게 시작'],['deep','심화 · 깊게 파고들기']], finder.level)}</li></ol>`;
  return `<form class="finder-search" id="finderSearchForm"><input id="finderQuery" type="search" value="${esc(finder.query)}" placeholder="궁금한 단어 (띄어 쓰면 모두 포함)" aria-label="궁금한 단어"><button class="hero-search-button" type="submit">찾기</button></form><p class="finder-note">수업 중 궁금했던 단어를 넣어 보세요. 찾은 예시를 ‘작은 질문’으로 바꾸는 방법은 계획서에서 안내합니다.</p>`;
}
const MODE_TEXT = {
  subject:['수행평가·탐구 주제 찾기','학년과 과목을 고르세요'],
  career:['희망 진로와 연결하기','관심 계열을 고르세요'],
  quiz:['나에게 맞는 탐구 추천','4가지 질문에 답해 보세요'],
  search:['궁금한 단어로 찾기','탐구 주제 → 과목 → 성취기준 순서로 보여 줍니다']
};
function topicCard(c) {
  const st = standardOf(c.sid, c.code);
  const title = readable(c.title, c.code) || '질문과 탐구 계획';
  const stText = st ? readable(st.displayText || st.text, c.code) : '';
  return `<article class="topic-card"><div class="topic-top">${statusChip(c.status)}${c.why?.length ? `<span class="why">${esc(c.why.join(' · '))}</span>` : ''}</div><h3>${esc(title)}</h3><p class="topic-meta"><b>${esc(c.subject.name)}</b> · <span class="code">[${esc(c.code)}]</span></p><p class="topic-standard">${esc(stText.length > 88 ? stText.slice(0, 88) + '…' : stText)}</p>${c.careers ? `<p class="topic-careers">연결 진로 · ${esc(c.careers)}</p>` : ''}<div class="topic-actions"><button class="outline" data-open="${c.sid}|${esc(c.code)}|${c.id}">자세히 보기</button><button class="outline" data-fsave="${c.sid}|${esc(c.code)}|${c.id}">${isSaved(c.sid, c.code, c.id) ? '★' : '☆'} 보관</button><button class="primary-small" data-fplan="${c.sid}|${esc(c.code)}|${c.id}">계획서로</button></div></article>`;
}
let lastResults = [];
async function renderFinder() {
  const [title, sub] = MODE_TEXT[finder.mode];
  $('#finderEyebrow').textContent = sub; $('#finderTitle').textContent = title;
  document.querySelectorAll('.finder-tabs [data-mode]').forEach(b => {b.classList.toggle('active', b.dataset.mode === finder.mode); b.setAttribute('aria-pressed', b.dataset.mode === finder.mode);});
  $('#finderControls').innerHTML = finderControls();
  const form = $('#finderSearchForm');
  if (form) form.onsubmit = e => {e.preventDefault(); finder.query = $('#finderQuery').value; finder.limit = PAGE; renderFinder();};
  if (!searchIndex) {
    $('#finderResults').innerHTML = empty('탐구 자료를 불러오는 중입니다… (처음 한 번)', '…');
    try {await loadSearchIndex();} catch {$('#finderResults').innerHTML = empty('자료를 불러오지 못했습니다. 새로고침해 주세요.'); return;}
  }
  const results = finderResults();
  lastResults = results || [];
  $('#finderMore').hidden = true;
  if (!results) {
    $('#finderCount').textContent = '';
    $('#finderResults').innerHTML = empty(finder.mode === 'quiz' ? '네 가지를 모두 고르면 탐구 6개를 추천합니다.' : finder.mode === 'subject' ? '과목을 고르면 그 과목의 탐구 주제를 보여 줍니다.' : finder.mode === 'career' ? '관심 계열을 고르면 연결 진로가 맞는 탐구를 보여 줍니다.' : '궁금한 단어를 넣어 보세요.', '↗');
    return;
  }
  const subjectLink = finder.mode === 'subject' && finder.subject ? ` <button class="text-button" data-subject-list="${finder.subject}">이 과목 성취기준 목록 보기</button>` : '';
  $('#finderCount').innerHTML = `${number(results.length)}개 주제${finder.mode === 'quiz' ? ' · 추천은 키워드 기준이니 선생님과 함께 확인하세요' : ''}${subjectLink}`;
  const hint = finder.mode === 'quiz' ? `<div class="level-hint">${finder.level === 'deep' ? '심화를 골랐습니다. 자세히 보기에서 <b>심화</b> 칸까지 읽고, 자료·실험으로 깊게 해 볼 부분을 고르세요.' : '기본을 골랐습니다. 자세히 보기에서 <b>기본</b> 칸부터 시작하고, 익숙해지면 심화 칸으로 넓혀 보세요.'}</div>` : '';
  $('#finderResults').innerHTML = results.length ? hint + results.slice(0, finder.limit).map(topicCard).join('') : empty($('#includeDrafts').checked ? '조건에 맞는 탐구가 없습니다. 다른 조건을 골라 보세요.' : '조건에 맞는 탐구가 없습니다. 아래 ‘초안도 보기’를 켜거나 다른 조건을 골라 보세요.', '⌕');
  $('#finderMore').hidden = results.length <= finder.limit;
}
function openFinder(mode, extra = {}) {
  Object.assign(finder, {mode, limit:PAGE}, extra);
  $('#finder').hidden = false;
  renderFinder();
  $('#finder').scrollIntoView({behavior:'smooth', block:'start'});
}
function findCard(ref) {const [sid, code, id] = ref.split('|'); return lastResults.find(c => c.sid === sid && c.code === code && c.id === id) || {sid, code, id, title:'', subject:subjectById(sid)};}
function openExample(sid, code, id) {
  const subject = subjectById(sid); if (!subject) return;
  state.focusExample = id;
  chooseSubject(subject, code).then(() => $('#explorerTitle').scrollIntoView({behavior:'smooth', block:'start'}));
}
// ---- inquiry plan ----
const PLAN_FIELDS = [
  {k:'subject', label:'과목'},
  {k:'standard', label:'연결 성취기준', area:2},
  {k:'reference', label:'참고한 예시', hint:'출발점으로만 씁니다. 문장을 그대로 옮기지 않습니다.'},
  {k:'wonder', label:'① 삶 속에서 떠오른 궁금증', hint:'수업·생활에서 “왜 그럴까?” 싶었던 장면을 적어요.', area:2},
  {group:'내 것으로 바꾸기 3단계', items:[
    {k:'target', label:'대상 바꾸기', hint:'누구·어디를 볼까? (예: 우리 반, 우리 학교, 창원)'},
    {k:'scope', label:'범위 줄이기', hint:'이번 주 안에 확인할 수 있는 크기로 좁혀요.'},
    {k:'check', label:'확인 방법', hint:'관찰·측정·설문·인터뷰·자료 분석 중 무엇으로 확인할까?'}]},
  {k:'question', label:'② 나의 탐구 질문 (한 문장)', hint:'예: “우리 반 학생의 수면 시간과 1교시 집중도는 어떤 관계가 있을까?”', area:2},
  {k:'concept', label:'③ 연결되는 교과 개념', hint:'이 질문을 풀 때 쓰는 수업 개념'},
  {k:'guess', label:'④ 처음 생각 (예상)', hint:'결과가 어떻게 나올 것 같나요? 이유는?', area:2},
  {k:'method', label:'⑤ 탐구 방법과 자료', hint:'무엇을 어떻게 모을지, 참고 자료의 출처까지', area:3},
  {k:'schedule', label:'⑥ 일정', hint:'예: 1주차 자료 모으기 → 2주차 정리·발표'},
  {k:'output', label:'⑦ 결과물', options:['보고서','발표 자료','포스터·인포그래픽','실험·관찰 기록','영상·제작물','기타']},
  {group:'활동을 마친 뒤', items:[
    {k:'result', label:'⑧ 알게 된 것 · 생각이 바뀐 점', hint:'처음 생각과 무엇이 달랐나요? 결과의 한계는?', area:3},
    {k:'next', label:'⑨ 다음 질문', hint:'이 탐구에서 새로 생긴 궁금증', area:2}]}
];
const PLAN_CHECKS = ['이번 주 안에 시작할 수 있다','내 주변에서 직접 확인할 수 있다','결과물이 분명하다 (표·그래프·발표 등)','AI·인터넷 자료는 출처를 적고, 생각은 내 문장으로 쓴다'];
const flatFields = () => PLAN_FIELDS.flatMap(f => f.items || [f]);
let currentPlan = null;
function newPlan(extra = {}) {return {id:'p' + Date.now().toString(36), updated:Date.now(), checks:[], ...Object.fromEntries(flatFields().map(f => [f.k, ''])), ...extra};}
function planFromCard(c) {
  const st = standardOf(c.sid, c.code);
  return newPlan({subject:c.subject?.name || '', standard:st ? `[${c.code}] ${readable(st.displayText || st.text, c.code)}` : c.code, reference:readable(c.title, c.code), link:{sid:c.sid, code:c.code, id:c.id}});
}
function planFromSelection(e) {const {subject:s, standard:st} = state.selected; return planFromCard({sid:s.id, code:st.code, id:e.id, title:exampleTitle(e, st.code), subject:s});}
function fieldHTML(f, plan) {
  const id = 'pf-' + f.k, value = esc(plan[f.k] || '');
  const input = f.options ? `<select id="${id}" data-field="${f.k}"><option value="">고르기</option>${f.options.map(o => `<option ${plan[f.k] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
    : f.area ? `<textarea id="${id}" data-field="${f.k}" rows="${f.area}">${value}</textarea>` : `<input id="${id}" data-field="${f.k}" value="${value}">`;
  return `<div class="pf"><label for="${id}">${esc(f.label)}</label>${f.hint ? `<small>${esc(f.hint)}</small>` : ''}${input}</div>`;
}
function openPlan(plan) {
  currentPlan = plan || newPlan();
  const p = currentPlan;
  const linkBtn = p.link ? `<button class="text-button" data-plan-open>참고한 예시 다시 보기 ↗</button>` : '<span class="finder-note">예시에서 시작하면 과목·성취기준이 자동으로 채워집니다. <button class="text-button" data-plan-find>예시 고르러 가기</button></span>';
  $('#planBody').innerHTML = `<div class="plan-intro"><b>탐구 한 바퀴</b> 궁금증 → 내 질문 → 처음 생각 → 방법·자료 → 결과와 생각의 변화 → 다음 질문. 빈칸은 나중에 채워도 됩니다. ${linkBtn}</div>
    <div class="plan-checks"><b>시작 전 체크</b>${PLAN_CHECKS.map((c, i) => `<label><input type="checkbox" data-check="${i}" ${p.checks.includes(i) ? 'checked' : ''}> ${esc(c)}</label>`).join('')}</div>
    <form class="plan-form" id="planForm">${PLAN_FIELDS.map(f => f.group ? `<fieldset><legend>${esc(f.group)}</legend>${f.items.map(x => fieldHTML(x, p)).join('')}</fieldset>` : fieldHTML(f, p)).join('')}</form>
    <p class="plan-save" id="planSaved" role="status">이 기기 브라우저에 자동 저장됩니다.</p>
    <div class="plan-actions"><button class="primary-small" data-plan-print>인쇄 · PDF로 저장</button><button class="outline" data-plan-copy>텍스트 복사</button><button class="outline" data-plan-new>새 계획서</button><button class="text-button danger" data-plan-delete>이 계획서 삭제</button></div>`;
  if (!$('#planDialog').open) $('#planDialog').showModal();
  $('#planDialog').scrollTop = 0;
}
function savePlan() {
  if (!currentPlan) return;
  currentPlan.updated = Date.now();
  const data = store(), at = data.plans.findIndex(x => x.id === currentPlan.id);
  if (at >= 0) data.plans[at] = currentPlan; else data.plans.unshift(currentPlan);
  const ok = persist(data); renderShelfCount();
  $('#planSaved').textContent = ok ? `자동 저장됨 · ${new Date().toLocaleTimeString('ko-KR', {hour:'2-digit', minute:'2-digit'})} (이 기기 브라우저)` : '이 브라우저는 저장을 막고 있습니다. 창을 닫기 전에 인쇄하거나 텍스트를 복사하세요.';
}
function planText(p) {
  return `내 탐구 계획서\n\n` + flatFields().map(f => `${f.label}\n${p[f.k] || ''}`).join('\n\n') + `\n\n시작 전 체크\n` + PLAN_CHECKS.map((c, i) => `${p.checks.includes(i) ? '[v]' : '[ ]'} ${c}`).join('\n') + '\n\n※ 탐구 예시는 참고 자료입니다. 실제 활동은 교과 담당 선생님과 내용과 수준을 확인하세요.';
}
function printPlan(p) {
  $('#printArea').innerHTML = `<div class="print-plan-page"><h1>내 탐구 계획서</h1><div class="print-meta"><span>학번 ________</span><span>이름 ____________</span><span>작성일 ${new Date(p.updated).toLocaleDateString('ko-KR')}</span></div><table>${flatFields().map(f => `<tr><th>${esc(f.label)}</th><td>${esc(p[f.k] || '').replace(/\n/g, '<br>')}</td></tr>`).join('')}<tr><th>시작 전 체크</th><td>${PLAN_CHECKS.map((c, i) => `${p.checks.includes(i) ? '☑' : '☐'} ${esc(c)}`).join('<br>')}</td></tr><tr><th>선생님 확인</th><td class="sign"></td></tr></table><p class="print-note">탐구 예시는 학습과 주제 탐구를 돕기 위한 참고 자료입니다. 이 계획서는 학생이 직접 작성하며, 실제 활동은 교과 담당 선생님과 내용과 수준을 확인합니다.</p></div>`;
  document.body.classList.add('print-plan');
  const done = () => {document.body.classList.remove('print-plan'); window.removeEventListener('afterprint', done);};
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 1500);
}
// ---- shelf and parent guide ----
function showShelf() {
  const d = store();
  const plans = d.plans.length ? `<ul class="shelf-list">${d.plans.map(p => `<li><div><b>${esc(p.question || p.reference || '제목 없는 계획서')}</b><small>${esc(p.subject || '과목 미정')} · ${new Date(p.updated).toLocaleDateString('ko-KR')}</small></div><button class="outline" data-shelf-plan="${p.id}">열기</button></li>`).join('')}</ul>` : '<p class="finder-note">아직 계획서가 없습니다. 예시에서 ‘이 예시로 내 탐구 시작하기’를 눌러 보세요.</p>';
  const saved = d.saved.length ? `<ul class="shelf-list">${d.saved.map(x => `<li><div><b>${esc(readable(x.title, x.code) || '탐구 예시')}</b><small>${esc(x.subject)} · [${esc(x.code)}]</small></div><span><button class="outline" data-shelf-open="${esc(x.key)}">보기</button><button class="text-button" data-shelf-remove="${esc(x.key)}">빼기</button></span></li>`).join('')}</ul>` : '<p class="finder-note">☆ 보관하기를 누른 예시가 여기에 모입니다.</p>';
  showDialog('내 보관함', `<p class="finder-note">보관함과 계획서는 <b>이 기기 브라우저에만</b> 저장됩니다. 다른 기기에서는 보이지 않고, 인터넷 사용 기록을 지우면 사라질 수 있으니 중요한 계획서는 인쇄하거나 PDF로 저장하세요. 이름 등 개인정보는 저장하지 않습니다.</p><h3>내 탐구 계획서 ${d.plans.length}</h3>${plans}<p><button class="primary-small" data-shelf-new>새 계획서 만들기</button></p><h3>보관한 예시 ${d.saved.length}</h3>${saved}`);
}
function parentGuide() {
  showDialog('학부모님께', `<p class="parent-lead"><strong>탐구는 아이가 직접 묻고, 확인하고, 생각을 바꿔 가는 과정입니다.</strong> 이 사이트는 그 출발점이 되는 질문과 탐구 예시를 수업의 성취기준과 연결해 보여 줍니다.</p>
    <h3>학생부에는 이렇게 남습니다</h3><ol class="parent-flow"><li><b>수업</b> 교과 성취기준을 배웁니다.</li><li><b>질문</b> 배운 내용에서 아이가 궁금증을 찾습니다.</li><li><b>수행평가·탐구</b> 질문을 확인하는 활동을 직접 합니다.</li><li><b>세특</b> 선생님이 관찰한 과정과 성장을 과목별 세부능력 및 특기사항에 기록합니다.</li></ol>
    <p>창원경일고는 2026 ‘질문하는 학교’ 선도학교로, 수업 속 질문이 탐구와 기록으로 이어지도록 하고 있습니다. 수행평가 내용을 점검해 수행평가 속 배움이 과목별 세특으로 이어지도록 관리합니다.</p>
    <h3>집에서는 이렇게 물어봐 주세요</h3><ul class="parent-q"><li>“요즘 수업에서 궁금했던 게 있었어?”</li><li>“그 탐구는 왜 골랐어? 어떻게 확인해 볼 거야?”</li><li>“예상과 다른 결과가 나오면 무엇을 알게 될까?”</li></ul>
    <h3>이렇게 도와주시면 좋습니다</h3><ul><li>정답이나 결과보다 <b>과정</b>을 물어봐 주세요. 학생부에는 학생이 실제로 한 활동만 기록됩니다.</li><li>예시를 그대로 옮기거나 대신 써 주면 다른 학생과 비슷한 기록이 반복되어 오히려 아이의 특징이 드러나지 않습니다.</li><li>아이가 만든 ‘내 탐구 계획서’를 함께 읽고, 일정과 안전(실험·설문 대상)을 확인해 주세요.</li></ul>
    <h3>사이트 이용 방법</h3><p>첫 화면에서 ‘희망 진로와 연결하고 싶어요’나 ‘나에게 맞는 탐구를 추천받고 싶어요’를 눌러 아이와 함께 주제를 골라 보세요. 탐구 예시는 참고 자료이며, 특정 탐구가 대학 입시에 유리하다는 뜻은 아닙니다.</p>`);
}
function bindStudentEvents() {
  document.querySelectorAll('[data-door]').forEach(b => b.onclick = () => {
    const door = b.dataset.door;
    if (door === 'plan') {const d = store(); openPlan(d.plans[0] || null); return;}
    openFinder(door);
  });
  document.querySelectorAll('.finder-tabs [data-mode]').forEach(b => b.onclick = () => openFinder(b.dataset.mode));
  $('#finderControls').onclick = event => {
    const b = event.target.closest('[data-pick]'); if (!b) return;
    const key = b.dataset.pick, value = b.dataset.value;
    finder[key] = finder[key] === value && key !== 'grade' ? '' : value;
    if (key === 'grade' && finder.mode === 'subject') finder.subject = '';
    finder.limit = PAGE; renderFinder();
  };
  $('#includeDrafts').onchange = () => {finder.limit = PAGE; renderFinder();};
  $('#finderMore').onclick = () => {finder.limit += PAGE; renderFinder();};
  $('#finderClose').onclick = () => {$('#finder').hidden = true;};
  $('#finderToExplorer').onclick = () => {
    if (finder.mode === 'search' && finder.query) {$('#globalSearch').value = finder.query; $('#globalSearch').dispatchEvent(new Event('input'));}
    else if (finder.mode === 'subject' && finder.subject) chooseSubject(subjectById(finder.subject));
    $('#explorerTitle').scrollIntoView({behavior:'smooth', block:'start'});
  };
  $('#finderResults').onclick = event => {
    const open = event.target.closest('[data-open]');
    if (open) {const [sid, code, id] = open.dataset.open.split('|'); openExample(sid, code, id); return;}
    const save = event.target.closest('[data-fsave]');
    if (save) {const c = findCard(save.dataset.fsave); const on = toggleSaved({sid:c.sid, code:c.code, id:c.id, title:c.title, subject:c.subject.name}); save.textContent = (on ? '★' : '☆') + ' 보관'; return;}
    const plan = event.target.closest('[data-fplan]');
    if (plan) openPlan(planFromCard(findCard(plan.dataset.fplan)));
  };
  $('#finderCount').onclick = event => {const b = event.target.closest('[data-subject-list]'); if (b) {chooseSubject(subjectById(b.dataset.subjectList)); $('#explorerTitle').scrollIntoView({behavior:'smooth', block:'start'});}};
  $('#planBody').oninput = event => {
    const f = event.target.dataset.field;
    if (f) {currentPlan[f] = event.target.value; clearTimeout(savePlan.timer); savePlan.timer = setTimeout(savePlan, 500);}
  };
  $('#planBody').onchange = event => {
    const c = event.target.dataset.check;
    if (c !== undefined) {const i = Number(c); currentPlan.checks = event.target.checked ? [...new Set([...currentPlan.checks, i])] : currentPlan.checks.filter(x => x !== i); savePlan();}
    else if (event.target.dataset.field) {currentPlan[event.target.dataset.field] = event.target.value; savePlan();}
  };
  $('#planBody').onclick = event => {
    const t = event.target.closest('button'); if (!t) return;
    if ('planPrint' in t.dataset) {savePlan(); printPlan(currentPlan);}
    else if ('planCopy' in t.dataset) copy(planText(currentPlan));
    else if ('planNew' in t.dataset) {savePlan(); openPlan(newPlan());}
    else if ('planDelete' in t.dataset) {const d = store(); d.plans = d.plans.filter(x => x.id !== currentPlan.id); persist(d); renderShelfCount(); currentPlan = null; $('#planDialog').close(); toast('계획서를 삭제했습니다.');}
    else if ('planOpen' in t.dataset) {const l = currentPlan.link; $('#planDialog').close(); openExample(l.sid, l.code, l.id);}
    else if ('planFind' in t.dataset) {$('#planDialog').close(); openFinder('quiz');}
  };
  $('#closePlan').onclick = () => {savePlan(); $('#planDialog').close();};
  $('#planDialog').addEventListener('close', () => {if (currentPlan) savePlan();});
  $('#shelfButton').onclick = showShelf;
  $('#parentButton').onclick = parentGuide;
  $('#dialogBody').addEventListener('click', event => {
    const t = event.target.closest('button'); if (!t) return;
    const d = store();
    if (t.dataset.shelfPlan) {$('#infoDialog').close(); openPlan(d.plans.find(p => p.id === t.dataset.shelfPlan));}
    else if ('shelfNew' in t.dataset) {$('#infoDialog').close(); openPlan(newPlan());}
    else if (t.dataset.shelfOpen) {const [sid, code, id] = t.dataset.shelfOpen.split('|'); $('#infoDialog').close(); openExample(sid, code, id);}
    else if (t.dataset.shelfRemove) {const x = d.saved.find(x => x.key === t.dataset.shelfRemove); if (x) toggleSaved(x); showShelf();}
  });
}
init();
