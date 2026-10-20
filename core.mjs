export const SUBJECTS = [
  { id: 'theory', label: '理論', symbol: 'V', lead: '電気を、式と図で捉える', description: '直流・交流回路、電界と磁界、電子回路、計測' },
  { id: 'power', label: '電力', symbol: 'P', lead: 'つくる・送る・届ける', description: '発電、変電、送配電、電気材料と電力設備' },
  { id: 'machine', label: '機械', symbol: 'M', lead: '電気と、動きのつながり', description: '電動機、変圧器、パワーエレクトロニクス、制御' },
  { id: 'law', label: '法規', symbol: '§', lead: '設備を、ルールで支える', description: '電気関係法令、技術基準、施設管理と計算' }
];
export const STORAGE_KEY = 'shikaku-denken-study-v1';
export const blankHistory = () => ({ version: 1, attempts: [], bookmarks: [], active: null, records: [] });
export const answerKey = (question, part) => `${typeof question === 'string' ? question : question.id}:${part || 'main'}`;
export function collectionSummary(data) {
  const years = [...new Set(data.papers.map(paper => paper.year))].sort((a, b) => a - b);
  return { firstYear: years[0], lastYear: years.at(-1), years: years.length, sessions: new Set(data.papers.map(paper => `${paper.year}-${paper.term}`)).size, papers: data.papers.length, questions: data.papers.reduce((sum, paper) => sum + paper.questions.length, 0), answers: data.papers.reduce((sum, paper) => sum + paper.questions.reduce((n, question) => n + question.answers.length, 0), 0) };
}
export function indexExams(data) {
  const papers = new Map();
  const questions = new Map();
  for (const paper of data.papers) {
    papers.set(paper.id, paper);
    for (const question of paper.questions) questions.set(question.id, { ...question, paperId: paper.id, subject: paper.subject });
  }
  return { papers, questions };
}
export function isCorrect(question, attempt) {
  return question.answers.find(answer => answer.part === attempt.part)?.correct === attempt.choice;
}
export function latestAttempts(history) {
  const result = new Map();
  for (const attempt of [...history.attempts].sort((a, b) => a.at.localeCompare(b.at))) result.set(answerKey(attempt.questionId, attempt.part), attempt);
  return result;
}
export function questionStatus(question, history, latest = latestAttempts(history)) {
  const answers = question.answers.map(answer => latest.get(answerKey(question, answer.part)));
  if (answers.every(answer => !answer)) return 'unseen';
  if (answers.some((answer, i) => answer && (answer.choice !== question.answers[i].correct || answer.assisted))) return 'review';
  if (answers.every(Boolean)) return 'correct';
  return 'partial';
}
export function filterQuestions(questions, history, { subject = 'all', paper = 'all', status = 'all', section = 'all' } = {}) {
  const latest = latestAttempts(history);
  return [...questions.values()].filter(question =>
    (subject === 'all' || question.subject === subject) &&
    (paper === 'all' || question.paperId === paper) &&
    (section === 'all' || question.section === section) &&
    (status === 'all' || questionStatus(question, history, latest) === status)
  );
}
export function paperQuestions(paper, optional = 17) {
  if (!paper.optionalGroups.length) return paper.questions;
  if (!paper.optionalGroups.includes(optional)) throw new Error('選択問題の指定が不正です。');
  return paper.questions.filter(question => !paper.optionalGroups.includes(question.number) || question.number === optional);
}
export function gradePaper(paper, choices, optional = 17) {
  const items = paperQuestions(paper, optional).map(question => {
    const answers = question.answers.map(answer => {
      const choice = choices[answerKey(question, answer.part)] || null;
      return { part: answer.part, choice, correct: answer.correct, points: answer.points, earned: choice === answer.correct ? answer.points : 0 };
    });
    return { questionId: question.id, number: question.number, answers };
  });
  const all = items.flatMap(item => item.answers);
  return {
    items,
    score: all.reduce((sum, answer) => sum + answer.earned, 0),
    maximum: all.reduce((sum, answer) => sum + answer.points, 0),
    answered: all.filter(answer => answer.choice !== null).length,
    correct: all.filter(answer => answer.earned > 0).length,
    total: all.length
  };
}
export function statistics(questions, history) {
  const latest = latestAttempts(history);
  const first = new Map();
  for (const attempt of [...history.attempts].sort((a, b) => a.at.localeCompare(b.at))) {
    const key = answerKey(attempt.questionId, attempt.part);
    if (!first.has(key)) first.set(key, attempt);
  }
  let answered = 0, correct = 0, firstCorrect = 0, firstTotal = 0, review = 0;
  for (const question of questions.values()) {
    if (questionStatus(question, history, latest) === 'review') review++;
    for (const answer of question.answers) {
      const current = latest.get(answerKey(question, answer.part));
      const initial = first.get(answerKey(question, answer.part));
      if (current) { answered++; if (isCorrect(question, current) && !current.assisted) correct++; }
      if (initial) { firstTotal++; if (isCorrect(question, initial) && !initial.assisted) firstCorrect++; }
    }
  }
  return { answered, correct, firstCorrect, firstTotal, review, attempts: history.attempts.length };
}
export function validateHistory(input, questionMap) {
  if (!input || input.version !== 1 || !Array.isArray(input.attempts) || input.attempts.length > 100000) throw new Error('このサイトの履歴JSONを選んでください。');
  const ids = new Map();
  const attempts = input.attempts.map(attempt => {
    const question = questionMap.get(attempt.questionId);
    if (!question || !question.answers.some(answer => answer.part === attempt.part) || !Number.isInteger(attempt.choice) || attempt.choice < 0 || attempt.choice > 5 || typeof attempt.id !== 'string' || attempt.id.length > 100 || !attempt.id || typeof attempt.at !== 'string' || !Number.isFinite(Date.parse(attempt.at))) throw new Error('履歴に不正な問題・回答・日時が含まれています。');
    const clean = { id: attempt.id, questionId: question.id, part: attempt.part, choice: attempt.choice, at: new Date(attempt.at).toISOString(), assisted: attempt.assisted === true, mode: attempt.mode === 'paper' ? 'paper' : 'practice' };
    if (ids.has(clean.id) && JSON.stringify(ids.get(clean.id)) !== JSON.stringify(clean)) throw new Error('同じ記録IDに異なる回答が含まれています。元の履歴は変更していません。');
    if (ids.has(clean.id)) return null;
    ids.set(clean.id, clean);
    return clean;
  }).filter(Boolean);
  const bookmarks = Array.isArray(input.bookmarks) ? [...new Set(input.bookmarks.filter(id => questionMap.has(id)))] : [];
  return { ...blankHistory(), attempts, bookmarks };
}
export function mergeHistory(current, imported, questionMap) {
  const validated = validateHistory(imported, questionMap);
  const attempts = new Map(current.attempts.map(attempt => [attempt.id, attempt]));
  let added = 0;
  for (const attempt of validated.attempts) {
    const existing = attempts.get(attempt.id);
    if (existing && ['questionId', 'part', 'choice', 'at', 'assisted', 'mode'].some(field => existing[field] !== attempt[field])) throw new Error('同じ記録IDの回答内容が異なります。取り込みを中止しました。');
    if (!existing) { attempts.set(attempt.id, attempt); added++; }
  }
  return { history: { ...current, attempts: [...attempts.values()].sort((a, b) => a.at.localeCompare(b.at)), bookmarks: [...new Set([...current.bookmarks, ...validated.bookmarks])] }, added };
}
export function relatedNotes(question, notes, limit = 3) {
  const text = question.text || '';
  return notes.filter(note => note.subject === question.subject).map(note => ({ note, score: note.keywords.reduce((score, keyword) => score + (text.includes(keyword) ? keyword.length : 0), 0) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(item => item.note);
}
