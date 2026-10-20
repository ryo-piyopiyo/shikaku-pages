import { SUBJECTS, STORAGE_KEY, blankHistory, indexExams, answerKey, filterQuestions, questionStatus, statistics, gradePaper, paperQuestions, validateHistory, mergeHistory, relatedNotes, collectionSummary } from './core.mjs';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const dateLabel = value => new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const subjectOf = id => SUBJECTS.find(subject => subject.id === id);
const statusLabel = { unseen: '未回答', correct: '自力で正解', review: '復習したい', partial: '回答途中' };
const state = { data: null, notes: [], explanations: {}, index: null, history: blankHistory(), canSave: true, corruptRaw: null, lastRaw: null, filters: { subject: 'all', paper: 'all', status: 'all', section: 'all' }, practiceTab: 'single', noteSubject: 'all', resultId: null };
let toastTimeout;

function notify(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { $('toast').hidden = true; }, 3500);
}
function mergeStored(raw, bookmark = null) {
  if (!raw || raw === state.lastRaw) return;
  const stored = JSON.parse(raw);
  const merged = mergeHistory(state.history, stored, state.index.questions);
  state.history.attempts = merged.history.attempts;
  state.history.bookmarks = validateHistory(stored, state.index.questions).bookmarks;
  if (bookmark) state.history.bookmarks = bookmark.add ? [...new Set([...state.history.bookmarks, bookmark.id])] : state.history.bookmarks.filter(id => id !== bookmark.id);
  const records = new Map(validRecords(stored.records).map(record => [record.id, record]));
  for (const record of state.history.records) records.set(record.id, record);
  state.history.records = [...records.values()].sort((a, b) => a.endedAt.localeCompare(b.endedAt)).slice(-200);
  state.lastRaw = raw;
}
function save(bookmark = null) {
  if (!state.canSave) return;
  try { mergeStored(localStorage.getItem(STORAGE_KEY), bookmark); const raw = JSON.stringify(state.history); localStorage.setItem(STORAGE_KEY, raw); state.lastRaw = raw; }
  catch { state.canSave = false; storageNotice('ブラウザーに保存できません。このページを閉じる前に「学習記録」から履歴を書き出してください。'); }
}
function storageNotice(message) { $('storageNotice').textContent = message; $('storageNotice').hidden = false; }
function validActive(active) {
  if (!active || !['practice', 'paper'].includes(active.mode) || typeof active.id !== 'string' || !Array.isArray(active.questionIds) || !active.questionIds.length || !active.questionIds.every(id => state.index.questions.has(id)) || !Number.isFinite(Date.parse(active.startedAt)) || !Number.isInteger(active.index) || active.index < 0 || active.index >= active.questionIds.length) return null;
  if (active.mode === 'paper' && !state.index.papers.has(active.paperId)) return null;
  if (active.mode === 'paper') {
    const paper = state.index.papers.get(active.paperId);
    if (paper.optionalGroups.length && !paper.optionalGroups.includes(active.optional)) return null;
    if (JSON.stringify(active.questionIds) !== JSON.stringify(paperQuestions(paper, active.optional).map(question => question.id))) return null;
  }
  const choices = {};
  for (const [key, value] of Object.entries(active.choices || {})) if (Number.isInteger(value) && value >= 0 && value <= 5) choices[key] = value;
  const booleanMap = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([id, checked]) => active.questionIds.includes(id) && checked === true)) : {};
  return { ...active, choices, graded: booleanMap(active.graded), assisted: booleanMap(active.assisted), flags: Array.isArray(active.flags) ? active.flags.filter(id => active.questionIds.includes(id)) : [], optional: active.optional === 18 ? 18 : 17 };
}
function validRecords(records) {
  if (!Array.isArray(records)) return [];
  return records.filter(record => {
    const paper = state.index.papers.get(record.paperId);
    return typeof record.id === 'string' && paper && record.choices && typeof record.choices === 'object' && !Array.isArray(record.choices) && Number.isFinite(Date.parse(record.endedAt)) && (!paper.optionalGroups.length || paper.optionalGroups.includes(record.optional));
  }).slice(-200);
}
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const stored = JSON.parse(raw);
      const active = validActive(stored.active);
      if (stored.active && !active) throw new Error('途中の演習の形式が不正です。');
      const records = validRecords(stored.records);
      if (Array.isArray(stored.records) && records.length !== Math.min(stored.records.length, 200)) throw new Error('通し演習の記録が不正です。');
      state.history = { ...validateHistory(stored, state.index.questions), active, records }; state.lastRaw = raw;
    } catch {
      state.corruptRaw = raw; state.canSave = false;
      storageNotice('保存されている履歴を読み込めませんでした。元のデータは上書きしていません。「学習記録」から退避できます。');
    }
  } catch { state.canSave = false; storageNotice('この環境ではブラウザー保存を使えません。回答はページ内で記録し、学習記録から書き出せます。'); }
}
function route() {
  const [name = 'home', query = ''] = location.hash.slice(1).split('?');
  return { name: name || 'home', params: new URLSearchParams(query) };
}
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
function paperLabel(paper) { return `${paper.era}${paper.termLabel} · ${paper.subjectLabel}`; }
function subjectOptions(selected, all = true) { return `${all ? '<option value="all">すべての科目</option>' : ''}${SUBJECTS.map(subject => `<option value="${subject.id}" ${selected === subject.id ? 'selected' : ''}>${subject.label}</option>`).join('')}`; }
function sectionHeading(kicker, title, description = '') { return `<div class="page-heading"><p class="eyebrow">${kicker}</p><h1>${title}</h1>${description ? `<p>${description}</p>` : ''}</div>`; }
function resumeBanner() {
  const active = state.history.active;
  if (!active) return '';
  const name = active.mode === 'paper' ? paperLabel(state.index.papers.get(active.paperId)) + 'の通し演習' : '一問ずつの演習';
  return `<div class="resume-banner"><div><span class="eyebrow">続きが残っています</span><strong>${name}</strong><span>${active.index + 1} / ${active.questionIds.length} 大問目</span></div><a class="button primary" href="#session">続きから解く <span aria-hidden="true">→</span></a></div>`;
}
function renderHome() {
  const coverage = collectionSummary(state.data);
  const stats = statistics(state.index.questions, state.history);
  const total = [...state.index.questions.values()].reduce((sum, question) => sum + question.answers.length, 0);
  return `<section class="hero"><div class="hero-copy"><p class="eyebrow"><span class="tiny-line"></span> 四科目を、ひとつずつ。</p><h1>過去問から、<br>わかる手応えを。</h1><p class="hero-description">まず一問。答えを確かめ、考え方をたどる。<br>あやふやなところは、要点ノートに戻ってみましょう。</p><div class="button-row"><a class="button primary large" href="#practice">過去問を解く <span aria-hidden="true">↗</span></a><a class="text-link" href="#notes">基礎から振り返る <span aria-hidden="true">→</span></a></div><p class="hero-meta">${coverage.firstYear}〜${coverage.lastYear}年度 · ${coverage.years}年分・${coverage.sessions}回 · ${state.index.questions.size}大問</p></div><aside class="progress-card" aria-label="学習の進み具合"><div class="progress-head"><span class="eyebrow">あなたの積み重ね</span><span class="small-tag">このブラウザー</span></div><div class="progress-number"><strong>${stats.answered}</strong><span>/ ${total} 解答欄</span></div><p>一度でも回答したところ</p><div class="progress-track" role="progressbar" aria-label="回答済み解答欄" aria-valuenow="${stats.answered}" aria-valuemin="0" aria-valuemax="${total}"><span style="width:${stats.answered / total * 100}%"></span></div><div class="progress-detail"><span>自力で正解 <strong>${stats.correct}</strong></span><span>復習候補 <strong>${stats.review}大問</strong></span></div><a class="text-link" href="#history">記録を見に行く <span aria-hidden="true">→</span></a></aside></section>
  ${resumeBanner()}
  <section class="section-block"><div class="section-title"><div><p class="eyebrow">SUBJECTS</p><h2>今日、取り組む科目は？</h2></div><span class="muted">一問からでも、続きになります。</span></div><div class="subject-grid">${SUBJECTS.map((subject, i) => {
    const questions = new Map([...state.index.questions].filter(([, question]) => question.subject === subject.id));
    const progress = statistics(questions, state.history);
    const slots = [...questions.values()].reduce((sum, question) => sum + question.answers.length, 0);
    return `<a class="subject-card subject-${subject.id}" href="#practice?subject=${subject.id}"><div class="subject-top"><span class="subject-number">0${i + 1}</span><span class="subject-symbol" aria-hidden="true">${subject.symbol}</span></div><h3>${subject.label}<span aria-hidden="true">↗</span></h3><strong class="subject-lead">${subject.lead}</strong><p>${subject.description}</p><div class="subject-bottom"><span>回答済み <strong>${progress.answered}</strong> / ${slots}欄</span><span>${questions.size}大問</span></div></a>`;
  }).join('')}</div></section>
  <section class="start-grid"><div class="study-block"><div class="block-icon" aria-hidden="true">↻</div><div><p class="eyebrow">REVIEW</p><h2>間違えたところを、もう一度。</h2><p>直近で間違えた問題と、要点を見て解いた問題が復習候補になります。自力で正解すれば候補から外れます。</p><a class="text-link" href="#practice?status=review">復習候補 ${stats.review} 大問へ <span aria-hidden="true">→</span></a></div></div><div class="study-block pale"><div class="block-icon" aria-hidden="true">▤</div><div><p class="eyebrow">FULL PAPER</p><h2>一回分を、最後まで。</h2><p>科目を選んで通し演習。途中では正答を表示せず、最後にまとめて採点します。途中保存にも対応。</p><a class="text-link" href="#paper">科目別の通し演習 <span aria-hidden="true">→</span></a></div></div></section>
  <div class="source-strip"><span class="source-dot" aria-hidden="true"></span><p>電気技術者試験センターの公開問題・公式解答を収録。解説と要点ノートは、このサイト独自の学習補足です。</p><a href="#about">収録内容を見る →</a></div>`;
}
function renderPractice(params, full = false) {
  if (params.has('subject') && subjectOf(params.get('subject'))) state.filters.subject = params.get('subject');
  if (params.has('status') && ['all', 'review', 'unseen', 'correct', 'partial'].includes(params.get('status'))) state.filters.status = params.get('status');
  if (full) state.practiceTab = 'paper';
  const subjects = `<div class="segmented" aria-label="演習の方法"><button data-action="practice-tab" data-value="single" class="${state.practiceTab === 'single' ? 'active' : ''}" aria-pressed="${state.practiceTab === 'single'}">一問ずつ</button><button data-action="practice-tab" data-value="paper" class="${state.practiceTab === 'paper' ? 'active' : ''}" aria-pressed="${state.practiceTab === 'paper'}">科目別の通し演習</button></div>`;
  if (state.practiceTab === 'paper') return `${sectionHeading('PAST PAPERS', '一回分に、取り組む。', '途中で正答を見ずに解き、最後にまとめて答え合わせをします。')}${subjects}${resumeBanner()}<div class="filter-strip"><label>科目<select id="paperSubject">${subjectOptions(state.filters.subject)}</select></label><p>制限時間は設けていません。目安は理論・電力・機械90分、法規65分です。</p></div><div class="paper-grid">${state.data.papers.filter(paper => state.filters.subject === 'all' || paper.subject === state.filters.subject).map(paper => `<article class="paper-card"><span class="subject-pill subject-${paper.subject}">${paper.subjectLabel}</span><h2>${paper.era}${paper.termLabel}</h2><p>${paperQuestions(paper).length}大問 · ${paper.subject === 'law' ? 16 : 20}解答欄 · 100点満点</p><p class="muted">${paper.optionalGroups.length ? '問17・18は、どちらか一方を選択。' : 'すべての問題を解答。'}目安${paper.minutes}分</p><button class="button secondary" data-action="start-paper" data-id="${paper.id}">この回を解く <span aria-hidden="true">→</span></button></article>`).join('')}</div>`;
  const papers = state.data.papers.filter(paper => state.filters.subject === 'all' || paper.subject === state.filters.subject);
  if (state.filters.paper !== 'all' && !papers.some(paper => paper.id === state.filters.paper)) state.filters.paper = 'all';
  const filtered = filterQuestions(state.index.questions, state.history, state.filters);
  return `${sectionHeading('PRACTICE', '一問ずつ、確かな理解へ。', '科目や実施回を選び、自分のペースで答え合わせ。わからない問題は、要点を見て考えられます。')}${subjects}${resumeBanner()}<section class="filter-card" aria-label="出題条件"><div class="filters"><label>科目<select id="filterSubject">${subjectOptions(state.filters.subject)}</select></label><label>実施回<select id="filterPaper"><option value="all">すべての実施回</option>${papers.map(paper => `<option value="${paper.id}" ${state.filters.paper === paper.id ? 'selected' : ''}>${paperLabel(paper)}</option>`).join('')}</select></label><label>取り組み状況<select id="filterStatus">${Object.entries({ all: 'すべて', unseen: '未回答', review: '復習候補', correct: '自力で正解済み', partial: '枝問が回答途中' }).map(([value, label]) => `<option value="${value}" ${state.filters.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>問題区分<select id="filterSection"><option value="all" ${state.filters.section === 'all' ? 'selected' : ''}>A・B両方</option><option value="A" ${state.filters.section === 'A' ? 'selected' : ''}>A問題</option><option value="B" ${state.filters.section === 'B' ? 'selected' : ''}>B問題</option></select></label></div><div class="filter-bottom"><p><strong>${filtered.length}</strong> 大問が対象です</p><div class="button-row"><label class="inline-label">出題数<select id="questionCount"><option value="5">5大問</option><option value="10" selected>10大問</option><option value="all">すべて</option></select></label><button class="button primary" data-action="start-filtered" ${!filtered.length ? 'disabled' : ''}>この条件で始める <span aria-hidden="true">→</span></button></div></div></section>
  ${!filtered.length ? '<div class="empty-state"><span aria-hidden="true">✓</span><h2>この条件の問題はありません。</h2><p>科目や取り組み状況を変えてみてください。</p><button class="button secondary" data-action="clear-filters">条件をリセット</button></div>' : `<div class="section-title compact"><h2>問題を選んで始める</h2><span class="muted">${filtered.length > 30 ? '先頭30大問を表示しています。' : `${filtered.length}大問`}</span></div><div class="question-list">${filtered.slice(0, 30).map(question => questionRow(question)).join('')}</div>`}`;
}
function questionRow(question) {
  const paper = state.index.papers.get(question.paperId);
  const status = questionStatus(question, state.history);
  return `<button class="question-row" data-action="start-question" data-id="${question.id}"><span class="subject-pill subject-${question.subject}">${paper.subjectLabel}</span><span class="question-row-title"><strong>${paper.era}${paper.termLabel} 問${question.number}</strong><small>${question.section}問題${question.answers.length > 1 ? ' · (a)(b)' : ''}${state.history.bookmarks.includes(question.id) ? ' · ★ 保存済み' : ''}</small></span><span class="status-tag status-${status}">${statusLabel[status]}</span><span aria-hidden="true">→</span></button>`;
}
function noteBody(note, compact = false, skipIntro = false) {
  return `${skipIntro ? '' : `<p class="note-lead">${escape(note.lead)}</p>${note.formula ? `<div class="formula">${escape(note.formula)}</div>` : ''}`}<h4>考える順序</h4><ol>${note.steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol><div class="condition"><strong>使うときの条件</strong><p>${escape(note.conditions)}</p></div>${note.example ? `<div class="worked-example"><h4>たとえば</h4><p>${escape(note.example.prompt)}</p><p class="example-solution">${escape(note.example.solution)}</p></div>` : ''}${!compact && note.sources?.length ? `<div class="note-sources">確認資料：${note.sources.map(source => `<a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.label)} ↗</a>`).join(' · ')}</div>` : ''}`;
}
function renderNotes(params) {
  if (params.has('subject') && subjectOf(params.get('subject'))) state.noteSubject = params.get('subject');
  const selected = params.get('id');
  const notes = state.notes.filter(note => (state.noteSubject === 'all' || note.subject === state.noteSubject) && (!selected || note.id === selected));
  return `${sectionHeading('STUDY NOTES', '式を覚える、その一歩先へ。', '何を求める式なのか、どんな条件で使えるのか。具体例と一緒に確かめる、四科目の要点ノートです。')}<div class="note-controls"><label>科目<select id="noteSubject">${subjectOptions(state.noteSubject)}</select></label>${selected ? '<a class="text-link" href="#notes">すべてのノートに戻る →</a>' : `<p class="muted">${notes.length}項目 · 独自作成の学習補足</p>`}</div><div class="notes-grid">${notes.map(note => `<article class="note-card" id="note-${escape(note.id)}"><div class="note-card-heading"><span class="subject-pill subject-${note.subject}">${subjectOf(note.subject)?.label}</span><h2>${escape(note.title)}</h2></div>${selected ? noteBody(note) : `<p>${escape(note.lead)}</p>${note.formula ? `<div class="formula small">${escape(note.formula)}</div>` : ''}<details><summary>考え方と具体例を読む</summary>${noteBody(note, false, true)}</details>`}<a class="text-link note-practice" href="#practice?subject=${note.subject}">${subjectOf(note.subject)?.label}の過去問へ →</a></article>`).join('')}</div>${!notes.length ? '<p class="empty-state">該当するノートが見つかりませんでした。</p>' : ''}`;
}
function currentQuestion() {
  const active = state.history.active;
  return active ? state.index.questions.get(active.questionIds[active.index]) : null;
}
function imageMarkup(question, lazy = false) {
  const canvasWidth = Math.max(...question.images.map(image => image.width));
  return `<p class="image-scroll-hint">画像は横にスクロールして、右端まで読めます。 →</p><div class="question-image-list"><div class="question-image-canvas">${question.images.map((image, i) => `<img class="question-image" style="width:${image.width / canvasWidth * 100}%" src="${escape(image.src)}" width="${image.width}" height="${image.height}" alt="${escape(state.index.papers.get(question.paperId).subjectLabel)} 問${question.number}の公式問題${question.images.length > 1 ? `（${i + 1}/${question.images.length}）` : ''}。図と選択肢を含みます。" loading="${lazy || i ? 'lazy' : 'eager'}" decoding="async">`).join('')}</div></div>`;
}
function answerDetail(question, choices, assisted = false) {
  return `${assisted ? '<p class="assisted-note">補助ありの答え合わせです。自力での正解とは分けて記録します。</p>' : ''}<div class="answer-results">${question.answers.map(answer => {
    const selected = choices[answerKey(question, answer.part)] || null;
    const correct = selected === answer.correct;
    return `<div class="answer-result ${correct ? 'is-correct' : 'is-wrong'}"><strong>${answer.part ? `(${answer.part}) ` : ''}${correct ? '正解です' : selected ? 'もう一度、考えてみよう' : '今回は未回答'}</strong><span>あなたの回答：${selected || '—'} <span aria-hidden="true">/</span> 公式正答：<b>${answer.correct}</b>（${answer.points}点）</span></div>`;
  }).join('')}</div>`;
}
function explanationMarkup(question) {
  const explanation = state.explanations[question.id];
  const related = explanation?.noteIds?.map(id => state.notes.find(note => note.id === id)).filter(Boolean);
  const notes = related?.length ? related : relatedNotes(question, state.notes);
  return `${explanation ? `<section class="explanation"><p class="eyebrow">考え方 · 独自解説</p><h3>${escape(explanation.summary)}</h3><ol>${explanation.steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol>${explanation.pitfall ? `<p class="pitfall"><strong>ここを確かめる</strong>${escape(explanation.pitfall)}</p>` : ''}</section>` : '<p class="explanation-note">この問題の個別解説は未収録です。公式正答と、科目の要点を使って見直せます。</p>'}<section class="related-notes"><h3>ついでに、ひとつ覚えよう。</h3><p class="muted">${notes.length ? '問題文の内容に関連する要点です。' : 'この科目の基本に戻って確かめられます。'}</p>${(notes.length ? notes : state.notes.filter(note => note.subject === question.subject).slice(0, 2)).map(note => `<details><summary><span>${escape(note.title)}</span><small>要点と具体例</small></summary>${noteBody(note, true)}</details>`).join('')}</section>`;
}
function renderSession() {
  const active = state.history.active;
  if (!active) return `${sectionHeading('PRACTICE', '続きの演習はありません。')}<a class="button primary" href="#practice">過去問を選ぶ</a>`;
  const question = currentQuestion();
  const paper = state.index.papers.get(question.paperId);
  const graded = !!active.graded[question.id];
  const isPaper = active.mode === 'paper';
  const flagged = active.flags.includes(question.id);
  const bookmarked = state.history.bookmarks.includes(question.id);
  const complete = question.answers.every(answer => active.choices[answerKey(question, answer.part)]);
  const unanswered = active.questionIds.filter(id => !state.index.questions.get(id).answers.every(answer => active.choices[answerKey(id, answer.part)])).length;
  return `<div class="session-top"><a class="text-link" href="#practice">← 条件選択に戻る</a><span class="session-type">${isPaper ? '通し演習 · 最後にまとめて採点' : '一問ずつ · その場で答え合わせ'}</span></div><div class="session-heading"><div><p class="eyebrow">${paper.era}${paper.termLabel} · ${paper.subjectLabel} · ${question.section}問題</p><h1>問${question.number}<span>${active.index + 1} / ${active.questionIds.length} 大問目</span></h1></div><div class="session-tools"><button class="icon-button ${bookmarked ? 'selected' : ''}" data-action="bookmark" aria-pressed="${bookmarked}">${bookmarked ? '★ 保存済み' : '☆ 保存する'}</button>${isPaper ? `<button class="icon-button ${flagged ? 'selected' : ''}" data-action="flag" aria-pressed="${flagged}">${flagged ? '⚑ 見直し中' : '⚐ 見直し'}</button>` : ''}</div></div>
  ${isPaper && paper.optionalGroups.length ? `<div class="optional-bar"><p><strong>選択問題</strong> 問17・問18のどちらか一方を採点します。</p><div class="segmented small"><button data-action="optional" data-value="17" aria-pressed="${active.optional === 17}" class="${active.optional === 17 ? 'active' : ''}">問17を選択</button><button data-action="optional" data-value="18" aria-pressed="${active.optional === 18}" class="${active.optional === 18 ? 'active' : ''}">問18を選択</button></div></div>` : ''}
  ${question.subject === 'law' ? '<p class="law-note">法規は出題当時の公式正答で採点します。現行法令の確認とは分けて学習してください。</p>' : ''}
  <div class="exercise-layout"><section class="problem-panel" aria-label="公式問題"><div class="problem-toolbar"><span>公式問題 · 図と選択肢</span><button class="text-link" data-action="enlarge">拡大して読む ↗</button></div>${imageMarkup(question)}<details class="text-alternative"><summary>問題文の抽出テキスト</summary><p>図・数式・上下付きの配置は、上の問題画像と原本PDFで確認してください。</p>${question.textUnavailable ? '<p>この原本は画像PDFのため、抽出テキストはありません。上の画像または原本PDFで問題を読めます。</p>' : `<pre>${escape(question.text)}</pre>`}</details><div class="problem-source">出典：${paper.era}${paper.termLabel} 第三種電気主任技術者試験 ${paper.subjectLabel} 問${question.number}。原本を画像化・切り出し。<a href="${escape(paper.pdf)}" target="_blank" rel="noopener">原本PDF ↗</a></div></section><aside class="answer-panel"><div class="answer-card"><p class="eyebrow">YOUR ANSWER</p><h2>${graded ? '答え合わせ' : '解答を選ぶ'}</h2><p class="muted">${question.answers.length > 1 ? '(a)・(b)の両方を選びます。' : '画像の選択肢(1)〜(5)から選びます。'}</p>${question.answers.map(answer => `<fieldset class="answer-group"><legend>${answer.part ? `(${answer.part})` : '解答'} <span>${answer.points}点</span></legend><div class="choice-grid">${[1, 2, 3, 4, 5].map(choice => `<label class="choice ${graded && answer.correct === choice ? 'correct-choice' : ''}"><input type="radio" name="choice-${answer.part || 'main'}" data-key="${answerKey(question, answer.part)}" value="${choice}" ${active.choices[answerKey(question, answer.part)] === choice ? 'checked' : ''} ${graded ? 'disabled' : ''}><span>${choice}</span></label>`).join('')}</div></fieldset>`).join('')}${!isPaper && !graded ? `<button class="button primary full" data-action="check" ${complete ? '' : 'disabled'}>答え合わせをする</button><button class="text-link unknown" data-action="unknown">わからないので、解説を見る</button>` : isPaper ? `<p class="saved-note" id="answerSaveNote">${complete ? '✓ この大問の解答を保存しました。' : '選ぶたびに、途中の解答を保存します。'}</p>` : answerDetail(question, active.choices, active.assisted[question.id])}${!isPaper && !graded ? `<details class="hint" id="hintPanel"><summary>要点を見て考える（補助あり）</summary><p>この問題は「補助あり」として記録します。</p>${(relatedNotes(question, state.notes, 1).length ? relatedNotes(question, state.notes, 1) : state.notes.filter(note => note.subject === question.subject).slice(0, 1)).map(note => `<h3>${escape(note.title)}</h3>${noteBody(note, true)}`).join('')}</details>` : ''}</div><div class="question-navigation"><button class="button secondary" data-action="previous" ${active.index === 0 ? 'disabled' : ''}>← 前の大問</button><button class="button ${graded ? 'primary' : 'secondary'}" data-action="next">${active.index === active.questionIds.length - 1 ? isPaper ? '採点へ進む' : '結果を見る' : '次の大問 →'}</button></div>${isPaper ? `<button class="text-link" data-action="next-unanswered">未回答へ移動（${unanswered}大問）</button><button class="button primary full finish-button" data-action="finish-paper">通し演習を採点する</button>` : ''}</aside></div>
  ${graded && !isPaper ? `<section class="feedback-panel">${explanationMarkup(question)}<div class="official-answer-link">公式解答：<a href="${escape(paper.answerPdf)}" target="_blank" rel="noopener">${paper.era}${paper.termLabel} 解答PDF ↗</a></div></section>` : ''}
  <section class="jump-section" aria-label="問題番号へ移動"><div class="section-title compact"><h2>問題を移動</h2><p class="muted">${isPaper ? '● 回答済み · ⚑ 見直し' : '✓ 答え合わせ済み'}</p></div><div class="jump-grid">${active.questionIds.map((id, index) => {
    const item = state.index.questions.get(id);
    const done = isPaper ? item.answers.every(answer => active.choices[answerKey(item, answer.part)]) : active.graded[id];
    return `<button class="jump-button ${index === active.index ? 'current' : ''} ${done ? 'done' : ''}" data-action="jump" data-index="${index}" aria-label="問${item.number}${done ? ' 回答済み' : ''}${active.flags.includes(id) ? ' 見直し' : ''}" ${index === active.index ? 'aria-current="step"' : ''}>${item.number}${active.flags.includes(id) ? '<small>⚑</small>' : done ? `<small>${isPaper ? '●' : '✓'}</small>` : ''}</button>`;
  }).join('')}</div><p class="muted save-description">進み具合と解答はこのブラウザー内に保存します。「続きから解く」で再開できます。</p></section>`;
}
function renderHistory() {
  const stats = statistics(state.index.questions, state.history);
  const bookmarks = state.history.bookmarks.map(id => state.index.questions.get(id)).filter(Boolean);
  const subjects = SUBJECTS.map(subject => {
    const subset = new Map([...state.index.questions].filter(([, question]) => question.subject === subject.id));
    const s = statistics(subset, state.history);
    return `<tr><th scope="row">${subject.label}</th><td>${s.answered}</td><td>${s.firstCorrect} / ${s.firstTotal}</td><td>${s.review}大問</td><td><a class="text-link" href="#practice?subject=${subject.id}&status=review">復習へ →</a></td></tr>`;
  }).join('');
  return `${sectionHeading('LEARNING LOG', '積み重ねを、次の一問へ。', '記録はこのブラウザーに保存します。初回の回答は、解き直しても置き換わりません。')}<div class="stat-grid"><div><span>累計の回答</span><strong>${stats.attempts}<small>回</small></strong></div><div><span>初回・補助なしの正解</span><strong>${stats.firstCorrect}<small>/ ${stats.firstTotal}欄</small></strong></div><div><span>復習候補</span><strong>${stats.review}<small>大問</small></strong></div></div><section class="section-block"><h2>科目ごとの記録</h2><div class="table-scroll"><table><thead><tr><th>科目</th><th>回答済み欄</th><th>初回の自力正解 / 初回回答</th><th>復習候補</th><th>取り組む</th></tr></thead><tbody>${subjects}</tbody></table></div><p class="muted">「要点を見て考える」を開いた回答と、未回答で解説を開いた回答は、初回の自力正解には含みません。</p></section><section class="section-block"><div class="section-title"><h2>通し演習の結果</h2><span class="muted">新しいものから表示</span></div>${state.history.records.length ? `<div class="records-list">${[...state.history.records].reverse().slice(0, 20).map(record => { const paper = state.index.papers.get(record.paperId); const grade = gradePaper(paper, record.choices, record.optional); return `<button class="record-row" data-action="show-result" data-id="${escape(record.id)}"><span><strong>${paperLabel(paper)}</strong><small>${dateLabel(record.endedAt)}</small></span><span class="record-score">${grade.score}<small>/ ${grade.maximum}点</small></span><span aria-hidden="true">→</span></button>`; }).join('')}</div>` : '<p class="empty-inline">通し演習を採点すると、ここに結果が残ります。</p>'}</section><section class="section-block"><div class="section-title"><h2>保存した問題</h2><span>${bookmarks.length}大問</span></div>${bookmarks.length ? `<div class="question-list">${bookmarks.slice(0, 30).map(questionRow).join('')}</div>` : '<p class="empty-inline">問題画面の「☆ 保存する」で、あとから解きたい問題を残せます。</p>'}</section><section class="export-card"><p class="eyebrow">YOUR DATA</p><h2>履歴を、持ち出す。</h2><p>JSONファイルに書き出すと、別のブラウザーでも回答と保存した問題を引き継げます。取り込みは既存の回答履歴に追加し、重複する記録は増やしません。解きかけの演習は取り込み対象外です。</p><div class="button-row"><button class="button primary" data-action="export-json">JSONで保存</button><button class="button secondary" data-action="export-text">テキストで保存</button><label class="button secondary file-label">JSONを取り込む<input type="file" id="historyImport" accept=".json,application/json"></label>${state.corruptRaw ? '<button class="button secondary" data-action="export-corrupt">読めなかった元データを退避</button>' : ''}</div><div class="danger-zone"><p>回答・途中の演習・保存した問題を消去します。必要な履歴は先に保存してください。</p><button class="text-link danger" data-action="reset-history">このブラウザーの記録を消去</button></div></section>`;
}
function renderResult(params) {
  const record = state.history.records.find(item => item.id === (params.get('id') || state.resultId));
  if (!record) return `${sectionHeading('RESULT', '結果が見つかりません。')}<a class="button primary" href="#history">学習記録へ</a>`;
  const paper = state.index.papers.get(record.paperId);
  const grade = gradePaper(paper, record.choices, record.optional);
  return `${sectionHeading('FULL PAPER RESULT', paperLabel(paper), `${dateLabel(record.endedAt)}に採点。出題当時の公式正答で答え合わせをしています。`)}<div class="result-overview"><div class="result-score"><strong>${grade.score}</strong><span>/ ${grade.maximum}点</span></div><div><h2>ここから、解き直そう。</h2><p>正解 ${grade.correct} / ${grade.total}欄 · 未回答 ${grade.total - grade.answered}欄</p><p>${paper.optionalGroups.length ? `選択問題は問${record.optional}を採点しました。` : '全問を採点しました。'} 合否判定は行いません。</p><a class="button secondary" href="#practice?subject=${paper.subject}&status=review">この科目の復習へ →</a></div></div><section class="section-block"><h2>問題ごとの答え合わせ</h2><div class="result-items">${grade.items.map(item => { const question = state.index.questions.get(item.questionId); const score = item.answers.reduce((sum, answer) => sum + answer.earned, 0); const max = item.answers.reduce((sum, answer) => sum + answer.points, 0); return `<details class="result-question"><summary><span>問${item.number}</span><span class="status-tag ${score === max ? 'status-correct' : 'status-review'}">${score === max ? '正解' : '見直す'}</span><strong>${score} / ${max}点</strong></summary>${answerDetail(question, record.choices)}${imageMarkup(question, true)}${explanationMarkup(question)}</details>`; }).join('')}</div></section><div class="button-row"><a class="button primary" href="#history">学習記録へ</a><a class="button secondary" href="#paper">別の通し演習を選ぶ</a><a class="text-link" href="${escape(paper.answerPdf)}" target="_blank" rel="noopener">公式解答PDF ↗</a></div>`;
}
function renderAbout() {
  const coverage = collectionSummary(state.data);
  return `${sectionHeading('ABOUT THIS ROOM', 'この学習室について。', '公式過去問と、自分の言葉で理解するための学習補足を組み合わせています。')}<article class="prose-card"><h2>収録している問題</h2><p>${coverage.firstYear}〜${coverage.lastYear}年度の${coverage.years}年度・${coverage.sessions}回分。理論・電力・機械・法規の計${coverage.papers}科目分、${coverage.questions}大問・${coverage.answers}解答欄を収録しています。公開された筆記試験の問題です。CBTの実問題ではありません。</p><p>問題は原本PDFから画像化し、大問ごとに切り出しています。文章・図・数値・選択肢は変更していません。抽出テキストでは数式や図の配置を再現できないため、問題画像と原本PDFで確認できます。</p><h2>答え合わせと解説</h2><p>正答・配点は、各回の公式解答に基づきます。理論・機械の通し演習では問17・18の一方を大問単位で選び、科目ごとに100点満点で採点します。練習モードでは、両方の選択問題に取り組めます。</p><p>個別の考え方の解説は令和8年度上期を対象に作成しています。それより前の${coverage.sessions - 1}回は公式正答と要点ノートで見直す構成です。解説・要点ノートは独自作成の学習補足で、試験センターが作成・監修したものではありません。法規の正答は出題当時のものとして扱います。</p><h2>記録の意味</h2><p>初回の回答、直近の回答、補助を見て答えた記録を区別します。「未回答」は、このブラウザーに回答の記録がないことを表します。問題を初めて目にしたかどうかの判定ではありません。間違い・未回答での答え合わせ・補助利用は復習候補になり、後で自力で正解すれば候補から外れます。</p><p>回答履歴はこの端末のブラウザーに保存され、サーバーには送信しません。端末を変えるときはJSONで書き出し、新しいブラウザーで取り込んでください。ブラウザーのサイトデータを消すと記録も消えます。Safariでは長期間使わない場合などにも保存が削除されることがあるため、ときどきJSONを書き出してください。</p><h2>iPadから使う</h2><p>iPadOS 15.4以降のSafariで公開URLを開きます。「共有」→「ホーム画面に追加」で、次からアイコンを押して開けます。PCとiPadの履歴は自動同期しないため、端末を移すときは「学習記録」からJSONで引き継いでください。</p><h2>操作方法</h2><p>Tabキーで移動し、選択肢は矢印キー、ボタンはEnterまたはSpaceで操作できます。画像は「拡大して読む」で開き、Escで閉じられます。スマートフォンでは画像を横スクロールして読めます。</p><h2>出典と利用条件</h2><p>過去問の著作権は一般財団法人 電気技術者試験センターに帰属します。同センターが示す教育目的の利用条件に基づき、年度・期・試験区分・科目・問題番号を各問題に明記しています。</p><ul><li><a href="https://www.shiken.or.jp/chief/third/qa/" target="_blank" rel="noopener noreferrer">公式過去問・解答と利用条件 ↗</a></li><li><a href="https://www.shiken.or.jp/chief/third/overview/" target="_blank" rel="noopener noreferrer">第三種電気主任技術者試験の概要 ↗</a></li><li><a href="https://www.shiken.or.jp/chief/upload/20260511r8tannai0526.pdf" target="_blank" rel="noopener noreferrer">令和8年度 受験案内 ↗</a></li></ul><p>元の学習サイト <a href="https://github.com/ryo-piyopiyo/denki-room-lab" target="_blank" rel="noopener noreferrer">denki-room-lab</a> の「一問ずつ・独自解説・任意の知識補足・復習・履歴持ち出し」の流れを参考に、電験三種の5択・枝問・科目別配点に合わせて作り直しました。</p></article>`;
}
function render() {
  if (!state.data) return;
  const { name, params } = route();
  let html;
  switch (name) {
    case 'practice': html = renderPractice(params); break;
    case 'paper': html = renderPractice(params, true); break;
    case 'notes': html = renderNotes(params); break;
    case 'session': html = renderSession(); break;
    case 'history': html = renderHistory(); break;
    case 'result': html = renderResult(params); break;
    case 'about': html = renderAbout(); break;
    default: html = renderHome();
  }
  $('main').innerHTML = html;
  for (const link of document.querySelectorAll('[data-nav]')) {
    const selected = link.dataset.nav === (['paper', 'session', 'result'].includes(name) ? 'practice' : name);
    link.classList.toggle('active', selected);
    if (selected) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }
  const hint = $('hintPanel');
  if (hint) hint.addEventListener('toggle', () => { if (hint.open) { const question = currentQuestion(); state.history.active.assisted[question.id] = true; save(); } });
}
async function confirmAction(title, text, label) {
  const dialog = $('confirmDialog');
  $('confirmTitle').textContent = title; $('confirmText').textContent = text; $('confirmYes').textContent = label;
  return new Promise(resolve => {
    const done = result => { dialog.close(); $('confirmYes').onclick = null; $('confirmNo').onclick = null; dialog.oncancel = null; resolve(result); };
    $('confirmYes').onclick = () => done(true); $('confirmNo').onclick = () => done(false);
    dialog.oncancel = event => { event.preventDefault(); done(false); };
    dialog.showModal(); $('confirmNo').focus();
  });
}
async function beginSession(questionIds, mode = 'practice', paperId = null) {
  if (!questionIds.length) return notify('対象の問題がありません。条件を変えてください。');
  if (state.history.active && !await confirmAction('新しい演習を始めますか？', '解きかけの演習は置き換わります。すでに答え合わせをした回答履歴は残ります。', '新しく始める')) return;
  state.history.active = { id: uid(), mode, paperId, questionIds, index: 0, choices: {}, graded: {}, assisted: {}, flags: [], optional: 17, startedAt: new Date().toISOString() };
  save(); go('#session'); window.scrollTo(0, 0);
}
function recordQuestion(question, mode) {
  const active = state.history.active;
  if (active.graded[question.id]) return;
  for (const answer of question.answers) state.history.attempts.push({ id: uid(), questionId: question.id, part: answer.part, choice: active.choices[answerKey(question, answer.part)] || 0, at: new Date().toISOString(), assisted: !!active.assisted[question.id], mode });
  active.graded[question.id] = true;
}
async function finishPaper() {
  const active = state.history.active;
  if (!active || active.mode !== 'paper') return;
  const paper = state.index.papers.get(active.paperId);
  const grade = gradePaper(paper, active.choices, active.optional);
  const unanswered = grade.total - grade.answered;
  if (!await confirmAction('通し演習を採点しますか？', `${unanswered ? `${unanswered}欄が未回答です。未回答は0点として採点します。` : 'すべての解答欄が選択されています。'}${active.flags.length ? ` 見直しマークは${active.flags.length}大問に残っています。` : ''}採点後は解答を変更できません。`, '採点して結果を見る')) return;
  for (const question of paperQuestions(paper, active.optional)) recordQuestion(state.index.questions.get(question.id), 'paper');
  const record = { id: active.id, paperId: paper.id, choices: { ...active.choices }, optional: active.optional, startedAt: active.startedAt, endedAt: new Date().toISOString() };
  state.history.records.push(record); state.history.records = state.history.records.slice(-200); state.resultId = record.id; state.history.active = null; save(); go(`#result?id=${encodeURIComponent(record.id)}`); window.scrollTo(0, 0);
}
function download(filename, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function textHistory() {
  const stats = statistics(state.index.questions, state.history);
  return ['電験三種 学習室 学習履歴', `書き出し：${dateLabel(new Date())}`, `回答：${stats.attempts}回、初回の自力正解：${stats.firstCorrect}/${stats.firstTotal}欄`, '', ...state.history.attempts.map(attempt => { const question = state.index.questions.get(attempt.questionId); const paper = state.index.papers.get(question.paperId); const answer = question.answers.find(item => item.part === attempt.part); return `${dateLabel(attempt.at)} | ${paperLabel(paper)} 問${question.number}${attempt.part ? `(${attempt.part})` : ''} | 回答 ${attempt.choice || '未回答'} / 公式正答 ${answer.correct} | ${attempt.assisted ? '補助あり' : '補助なし'} | ${attempt.mode === 'paper' ? '通し演習' : '一問ずつ'}`; })].join('\n');
}
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled || !state.index) return;
  const action = button.dataset.action;
  const active = state.history.active;
  switch (action) {
    case 'practice-tab': state.practiceTab = button.dataset.value; if (route().name === 'paper') go('#practice'); else render(); break;
    case 'clear-filters': state.filters = { subject: 'all', paper: 'all', status: 'all', section: 'all' }; go('#practice'); break;
    case 'start-filtered': { const filtered = filterQuestions(state.index.questions, state.history, state.filters); const count = $('questionCount').value; await beginSession(filtered.slice(0, count === 'all' ? filtered.length : Number(count)).map(question => question.id)); break; }
    case 'start-question': await beginSession([button.dataset.id]); break;
    case 'start-paper': { const paper = state.index.papers.get(button.dataset.id); await beginSession(paperQuestions(paper).map(question => question.id), 'paper', paper.id); break; }
    case 'bookmark': { const id = currentQuestion().id; const add = !state.history.bookmarks.includes(id); state.history.bookmarks = add ? [...state.history.bookmarks, id] : state.history.bookmarks.filter(item => item !== id); save({ id, add }); render(); break; }
    case 'flag': { const id = currentQuestion().id; active.flags = active.flags.includes(id) ? active.flags.filter(item => item !== id) : [...active.flags, id]; save(); render(); break; }
    case 'optional': { const current = currentQuestion(); active.optional = Number(button.dataset.value); active.questionIds = paperQuestions(state.index.papers.get(active.paperId), active.optional).map(question => question.id); const newIndex = active.questionIds.indexOf(current.id); active.index = newIndex >= 0 ? newIndex : active.questionIds.length - 1; active.flags = active.flags.filter(id => active.questionIds.includes(id)); save(); render(); break; }
    case 'check': { const question = currentQuestion(); if (!question.answers.every(answer => active.choices[answerKey(question, answer.part)])) return; recordQuestion(question, 'practice'); save(); render(); document.querySelector('.feedback-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); break; }
    case 'unknown': { const question = currentQuestion(); active.assisted[question.id] = true; recordQuestion(question, 'practice'); save(); render(); document.querySelector('.feedback-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); break; }
    case 'previous': if (active.index > 0) { active.index--; save(); render(); window.scrollTo(0, 0); } break;
    case 'jump': active.index = Number(button.dataset.index); save(); render(); window.scrollTo(0, 0); break;
    case 'next': if (active.index < active.questionIds.length - 1) { active.index++; save(); render(); window.scrollTo(0, 0); } else if (active.mode === 'paper') await finishPaper(); else { const checked = Object.keys(active.graded).length; if (checked < active.questionIds.length && !await confirmAction('一問ずつの演習を終えますか？', `${active.questionIds.length - checked}大問はまだ答え合わせをしていません。答え合わせ済みの記録は残ります。`, '演習を終える')) return; state.history.active = null; save(); go('#history'); window.scrollTo(0, 0); } break;
    case 'next-unanswered': { const indices = [...active.questionIds.keys()]; const next = indices.slice(active.index + 1).concat(indices.slice(0, active.index + 1)).find(index => !state.index.questions.get(active.questionIds[index]).answers.every(answer => active.choices[answerKey(active.questionIds[index], answer.part)])); if (next === undefined) notify('すべての解答欄が選択されています。'); else { active.index = next; save(); render(); window.scrollTo(0, 0); } break; }
    case 'finish-paper': await finishPaper(); break;
    case 'show-result': state.resultId = button.dataset.id; go(`#result?id=${encodeURIComponent(state.resultId)}`); window.scrollTo(0, 0); break;
    case 'enlarge': $('enlargedImages').innerHTML = imageMarkup(currentQuestion()); $('imageDialog').showModal(); break;
    case 'close-image': $('imageDialog').close(); break;
    case 'export-json': download(`denken-history-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ ...state.history, exportedAt: new Date().toISOString() }, null, 2), 'application/json'); notify('履歴JSONを保存しました。'); break;
    case 'export-text': download('denken-history.txt', textHistory(), 'text/plain;charset=utf-8'); break;
    case 'export-corrupt': download('denken-history-recovery.txt', state.corruptRaw, 'text/plain;charset=utf-8'); break;
    case 'reset-history': if (await confirmAction('学習記録を消去しますか？', 'このブラウザーの回答履歴・保存した問題・解きかけの演習・通し演習の結果をすべて消します。取り消せません。必要なら先にJSONで保存してください。', '記録を消去する')) { try { localStorage.removeItem(STORAGE_KEY); state.canSave = true; } catch { state.canSave = false; } state.history = blankHistory(); state.corruptRaw = null; state.lastRaw = null; $('storageNotice').hidden = state.canSave; render(); notify('学習記録を消去しました。'); } break;
  }
});
document.addEventListener('change', async event => {
  const target = event.target;
  const fields = { filterSubject: 'subject', filterPaper: 'paper', filterStatus: 'status', filterSection: 'section', paperSubject: 'subject' };
  if (fields[target.id]) { state.filters[fields[target.id]] = target.value; if (target.id === 'filterSubject') state.filters.paper = 'all'; const base = route().name === 'paper' ? '#paper' : '#practice'; if (location.hash.includes('?')) go(base); else render(); return; }
  if (target.id === 'noteSubject') { state.noteSubject = target.value; go('#notes'); return; }
  if (target.matches('input[type="radio"][data-key]')) {
    const active = state.history.active; const question = currentQuestion();
    if (!active || active.graded[question.id]) return;
    active.choices[target.dataset.key] = Number(target.value); save();
    const complete = question.answers.every(answer => active.choices[answerKey(question, answer.part)]);
    const check = document.querySelector('[data-action="check"]'); if (check) check.disabled = !complete;
    if ($('answerSaveNote')) $('answerSaveNote').textContent = complete ? '✓ この大問の解答を保存しました。' : '✓ 解答を保存しました。もう一方の枝問も選んでください。';
    const jump = document.querySelector(`[data-action="jump"][data-index="${active.index}"]`); if (active.mode === 'paper' && jump) { jump.classList.toggle('done', complete); const small = jump.querySelector('small'); if (!small && complete) jump.insertAdjacentHTML('beforeend', '<small>●</small>'); }
    const unansweredLink = document.querySelector('[data-action="next-unanswered"]'); if (unansweredLink) { const n = active.questionIds.filter(id => !state.index.questions.get(id).answers.every(answer => active.choices[answerKey(id, answer.part)])).length; unansweredLink.textContent = `未回答へ移動（${n}大問）`; }
  }
  if (target.id === 'historyImport' && target.files[0]) {
    try { if (target.files[0].size > 20_000_000) throw new Error('ファイルが大きすぎます。20MB以下の履歴JSONを選んでください。'); const imported = JSON.parse(await target.files[0].text()); const result = mergeHistory(state.history, imported, state.index.questions); state.history = result.history; save(); render(); notify(`${result.added}件の回答を追加しました。`); }
    catch (error) { notify(`取り込めませんでした。${error.message}`); }
    target.value = '';
  }
});
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); $('main').focus({ preventScroll: true }); });
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY || !state.index || !state.canSave) return;
  if (event.newValue === null) { state.canSave = false; storageNotice('別のタブで学習記録が消去されました。このタブを再読み込みするまで自動保存を止めています。必要な履歴は書き出せます。'); return; }
  try { mergeStored(event.newValue); if (route().name !== 'session') render(); notify('別のタブの回答履歴を統合しました。解きかけの演習は同時に複数タブで操作しないでください。'); }
  catch { state.canSave = false; storageNotice('別のタブの記録を統合できません。元データを上書きせず、このタブの自動保存を止めています。履歴を書き出して確認してください。'); }
});

async function boot() {
  try {
    const [data, knowledge, explanations] = await Promise.all(['data/exams.json', 'data/knowledge.json', 'data/explanations.json'].map(async path => { const response = await fetch(path); if (!response.ok) throw new Error(`${path}の読み込みに失敗しました（${response.status}）。`); return response.json(); }));
    state.data = data; state.notes = knowledge.notes; state.explanations = explanations.items; state.index = indexExams(data); load(); render();
  } catch (error) { $('main').innerHTML = `<div class="empty-state"><h1>問題を読み込めませんでした。</h1><p>${escape(error.message)}</p><p>ローカルで開く場合は、READMEにあるサーバー起動手順を使ってください。</p><button class="button primary" id="retryLoad">もう一度読み込む</button></div>`; $('retryLoad').onclick = boot; }
}
boot();
